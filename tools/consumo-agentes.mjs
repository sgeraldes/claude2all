#!/usr/bin/env node
// Consumo de los agentes en Bedrock (cuenta internal-apps-dev, us-west-2): costo real por
// día y por modelo desde Cost Explorer (líneas "OpenAI GPT-5.6 ... (Amazon Bedrock Edition)"
// y "Amazon Bedrock"), acumulado del mes, e invocaciones y tokens por modelo desde CloudWatch.
//
//   node tools/consumo-agentes.mjs [--dias 7] [--profile <perfil>] [--region us-west-2] [--json]
//
// Cost Explorer llega con hasta 24 h de retraso: el día en curso es parcial. La atribución por
// agente y por corrida la define SPEC-130 (métricas propias del proxy); acá solo hay cuenta,
// modelo y día, que es lo que factura AWS.
import { CostExplorerClient, GetCostAndUsageCommand } from '@aws-sdk/client-cost-explorer';
import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { fromSSO } from '@aws-sdk/credential-provider-sso';

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}
const dias = Math.max(1, Number.parseInt(option('--dias', '7'), 10) || 7);
const profile = option('--profile', process.env.AWS_PROFILE || 'dfx5-dfx5-internal-apps-dev-administratoraccess');
const region = option('--region', 'us-west-2');
const asJson = process.argv.includes('--json');
const credentials = fromSSO({ profile });

const hoy = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const desde = new Date(hoy); desde.setUTCDate(desde.getUTCDate() - dias + 1);
const manana = new Date(hoy); manana.setUTCDate(manana.getUTCDate() + 1);
const inicioMes = `${iso(hoy).slice(0, 7)}-01`;

const ce = new CostExplorerClient({ region: 'us-east-1', credentials });
const esBedrock = (nombre) => /amazon bedrock/i.test(nombre) || /\(amazon bedrock edition\)/i.test(nombre);

async function costoPorDia(start, end) {
  const result = await ce.send(new GetCostAndUsageCommand({
    TimePeriod: { Start: start, End: end },
    Granularity: 'DAILY',
    Metrics: ['UnblendedCost'],
    GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
  }));
  return result.ResultsByTime.map((r) => ({
    dia: r.TimePeriod.Start,
    lineas: r.Groups.filter((g) => esBedrock(g.Keys[0])).map((g) => ({ servicio: g.Keys[0].replace(' (Amazon Bedrock Edition)', ''), usd: Number(g.Metrics.UnblendedCost.Amount) })).filter((l) => l.usd > 0),
  }));
}

const cw = new CloudWatchClient({ region, credentials });
const modelos = ['us.openai.gpt-6-astra', 'us.openai.gpt-5.6-sol', 'us.openai.gpt-5.6-terra', 'us.openai.gpt-5.6-luna'];
async function metrica(modelo, nombre, horas) {
  const end = new Date();
  const start = new Date(end.getTime() - horas * 3600 * 1000);
  const r = await cw.send(new GetMetricStatisticsCommand({ Namespace: 'AWS/Bedrock', MetricName: nombre, Dimensions: [{ Name: 'ModelId', Value: modelo }], StartTime: start, EndTime: end, Period: horas * 3600, Statistics: ['Sum'] }));
  return r.Datapoints?.[0]?.Sum ?? 0;
}

const [porDia, mes] = await Promise.all([costoPorDia(iso(desde), iso(manana)), costoPorDia(inicioMes, iso(manana))]);
const totalMes = mes.reduce((s, d) => s + d.lineas.reduce((t, l) => t + l.usd, 0), 0);
const porModeloMes = {};
for (const d of mes) for (const l of d.lineas) porModeloMes[l.servicio] = (porModeloMes[l.servicio] || 0) + l.usd;
const uso = {};
for (const modelo of modelos) {
  uso[modelo] = { invocaciones24h: await metrica(modelo, 'Invocations', 24), invocaciones7d: await metrica(modelo, 'Invocations', 24 * 7), tokensEntrada24h: await metrica(modelo, 'InputTokenCount', 24), tokensSalida24h: await metrica(modelo, 'OutputTokenCount', 24) };
}

const salida = { cuenta: profile, region, generado: hoy.toISOString(), costoPorDia: porDia, mesEnCurso: { desde: inicioMes, totalUsd: Number(totalMes.toFixed(2)), porModelo: Object.fromEntries(Object.entries(porModeloMes).map(([k, v]) => [k, Number(v.toFixed(2))])) }, usoCloudWatch: uso, nota: 'Cost Explorer llega con hasta 24 h de retraso; el día en curso es parcial.' };
if (asJson) { console.log(JSON.stringify(salida, null, 2)); process.exit(0); }

console.log(`Consumo de agentes en Bedrock · perfil ${profile} · ${region}`);
console.log(`Mes en curso desde ${inicioMes}: USD ${totalMes.toFixed(2)}`);
for (const [k, v] of Object.entries(porModeloMes).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(34)} USD ${v.toFixed(2)}`);
console.log(`\nPor día (últimos ${dias} días, el de hoy parcial):`);
for (const d of porDia) {
  const total = d.lineas.reduce((t, l) => t + l.usd, 0);
  console.log(`  ${d.dia}  USD ${total.toFixed(2).padStart(7)}  ${d.lineas.map((l) => `${l.servicio.replace('OpenAI ', '')}=${l.usd.toFixed(2)}`).join(', ')}`);
}
console.log('\nInvocaciones (CloudWatch AWS/Bedrock):');
console.log('  modelo                      24 h    7 días   tokens entrada 24 h   tokens salida 24 h');
for (const [modelo, u] of Object.entries(uso)) console.log(`  ${modelo.padEnd(26)} ${String(u.invocaciones24h).padStart(5)}  ${String(u.invocaciones7d).padStart(7)}   ${String(u.tokensEntrada24h).padStart(18)}   ${String(u.tokensSalida24h).padStart(18)}`);
console.log(`\n${salida.nota}`);
