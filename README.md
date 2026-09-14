<p align="center">
  <img src="docs/images/claude2all-hero.png" alt="claude2all" width="720" />
</p>

<h1 align="center">claude2all</h1>

<p align="center">
  Run Claude Code on every backend and account you have — side by side, never interfering.
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> •
  <a href="#way-1-standalone-in-your-terminal">Standalone</a> •
  <a href="#way-2-inside-claude-code-subagents">Subagents</a> •
  <a href="#setup-per-backend">Setup</a> •
  <a href="#how-it-works">How it works</a>
</p>

One small launcher per backend. Each gets its own isolated profile (config, login,
history, settings), so sessions never touch each other — or your main `claude`.
Windows + Git Bash first; every launcher also has a `.cmd` twin for PowerShell.

## Quick start

```bash
git clone https://github.com/sgeraldes/claude2all
cd claude2all
./install.sh        # copies launchers to ~/.local/bin, subagents to ~/.claude/agents
claude2all setup    # interactive wizard: pick backends, enter keys, do logins,
                    # build/install the claude2openai and claude2kiro proxies
```

The wizard asks which backends you want, then walks each one: API keys (hidden
input), browser logins opened for you (Kimi console, AWS SSO, claude.ai OAuth,
codex login), and building/installing the two proxy projects. Rerun it any time;
`claude2all` (or `claude2all status`) shows what is configured and working.

Then:

```bash
claude2kimi        # Claude Code, powered by Kimi K3
claude2bedrock     # Claude Code, powered by your AWS Bedrock account
claude2work        # Claude Code on your second claude.ai subscription
```

## Way 1: Standalone (in your terminal)

Each launcher is a full Claude Code session on that backend — anything `claude`
accepts works:

```bash
claude2kimi                          # interactive session
claude2kimi -p "explain src/api/"    # one-shot headless answer
claude2bedrock --resume              # resume last session (per-profile history)
```

| Launcher | Backend | Models it loads |
|---|---|---|
| `claude2kimi` | [Kimi Code](https://www.kimi.com/code/docs) plan | `k3[1m]` main · `kimi-for-coding` sonnet · `kimi-for-coding-highspeed` haiku |
| `claude2kiro run` | AWS Kiro via **[claude2kiro](https://github.com/sgeraldes/claude2kiro)** | nothing pinned — `auto`, Kiro picks per request |
| `claude2bedrock` | AWS Bedrock native (Claude) | opus 4.8 main · sonnet 5 sonnet · haiku 4.5 (configurable) |
| `claude2bedrock --openai` | AWS Bedrock Converse (OpenAI) | Astra default · Sol · Terra · Luna for haiku-class requests; `--model` / `--effort` |
| `claude2openai` | OpenAI via ChatGPT OAuth (Codex CLI session) | `gpt-5.6-sol` main · `gpt-5.6-terra` sonnet · `gpt-5.6-luna` haiku |
| `claude2personal` | claude.ai subscription #1 | unpinned (account default; `/model` to change) |
| `claude2work` | claude.ai subscription #2 (team) | unpinned |

## Way 2: Inside Claude Code (subagents)

The installer also drops delegation subagents into `~/.claude/agents/`. Inside any
regular Claude Code session you just ask in natural language:

```
> use the kimi-k3 subagent to review src/auth.ts
> have the bedrock subagent write the terraform for an S3 bucket
```

Claude stays the orchestrator; the named backend does the delegated work headlessly
(`claude2<backend> -p "<task>"`) and returns its output. Available subagents:
`kimi-k3`, `kiro`, `bedrock`, `openai`. Check `/agents` in a session to see them.

## Setup per backend

- **`claude2kimi`** — paste your Kimi Code API key into `~/.claude2kimi/config`
  (Kimi Code Console → Create API Key).
- **`claude2bedrock`** has two modes. Without a flag it keeps Claude Code's native
  Bedrock/InvokeModel path for Anthropic models. `claude2bedrock --openai` uses the
  local proxy plus ConverseStream for OpenAI models. OpenAI mode defaults to profile
  `dfx5-dfx5-internal-apps-dev-administratoraccess`, region `us-west-2`, and Astra;
  override these with `BEDROCK_OPENAI_AWS_PROFILE`, `BEDROCK_OPENAI_AWS_REGION`,
  `BEDROCK_MODEL` (`astra`, `sol`, `terra`, `luna`, or a full inference profile ID),
  and `BEDROCK_SMALL_MODEL` (default `luna`). `--model <alias>` is the command-line
  equivalent of `BEDROCK_MODEL`; `--effort <low|medium|high|max>` exports
  `BEDROCK_EFFORT`, which wins over Claude Code's own effort signal. The proxy sends
  this accepted Bedrock OpenAI shape: `{"reasoning":{"effort":"<value>"}}`.
  Defaults are Astra/Sol `high`, Terra `max`, Luna `medium`. Run `aws sso login --sso-session dfx5`
  if the SSO token expires. `claude2bedrock --openai test --model terra --effort max`
  verifies the full proxy path.

### OpenAI Bedrock combinations

```bash
claude2bedrock --openai --model luna --effort medium -p "despliega y verifica el servicio"
claude2bedrock --openai --model terra --effort max -p "implementa y prueba el cambio"
claude2bedrock --openai --model sol --effort high -p "resuelve este problema complejo"
claude2bedrock --openai --model astra --effort high -p "revisa este diff y encuentra bugs"
```

Use Luna medium for deployments and operations; Terra max for coding; Sol high for
complex tasks; and Astra high for design plus complex reviews, including code review,
adversarial review, and bug hunting.
- **`claude2kiro`** — install **[sgeraldes/claude2kiro](https://github.com/sgeraldes/claude2kiro)**
  (proxy with login, TUI dashboard, credits tracking) and use `claude2kiro run`.
- **`claude2openai`** — log into the Codex CLI once (`codex login`), then build the
  proxy from **[sgeraldes/claude2openai](https://github.com/sgeraldes/claude2openai)**
  and place the binary at `~/.claude2openai/claude2openai.exe`.
- **`claude2personal`** — nothing to do; it imports your existing `~/.claude` login once.
- **`claude2work`** — first run opens browser OAuth; sign in with the second account.

## How it works

The backend launchers select an isolated profile in `~/.claude-profiles/<backend>`,
call `bin/claude2all-profile.cjs`, export the backend environment and model pins,
then execute Claude Code or the backend proxy. Kiro calls the separately installed
`~/.local/bin/claude2kiro.exe`; `CLAUDE2KIRO_EXE` can select another binary path.
The `.cmd` shims call the adjacent Bash launcher, which uses the same shared script.
Nothing writes to the source `~/.claude`.

## Perfiles: sincronización en cada lanzamiento

`claude2kiro`, `claude2openai`, `claude2kimi` y `claude2bedrock` sincronizan las
instrucciones antes de iniciar Claude Code. Bedrock cubre los perfiles `bedrock`
y `bedrock-openai`. `claude2personal` y `claude2work` mantienen su seed propio.
Los comandos de administración de OpenAI que no inician Claude Code conservan
su paso directo al proxy.

- `~/.claude/CLAUDE.md` sobrescribe el del perfil cuando cambia. Una edición en el
  perfil se reemplaza en el próximo lanzamiento. Si el destino es un enlace de
  archivo, se reemplaza el enlace por una copia sin escribir sobre su destino.
- `~/.claude/skills` aporta archivos nuevos y actualizados, incluidas referencias
  y archivos sueltos. Los enlaces y junctions existentes del perfil se conservan
  sin recorrerlos. Los enlaces nuevos del origen se replican como enlaces con
  destino absoluto; no se copian sus contenidos.
- `.claude2all-sync.json` registra las copias. Si un archivo desaparece del origen,
  se borra del perfil sólo si está registrado y conserva el hash de la copia.
  Los directorios registrados se retiran sólo cuando quedan vacíos. Una copia
  modificada localmente cuyo origen desapareció se conserva. En la primera
  sincronización, los archivos antiguos sin equivalente en el origen se conservan
  porque no se puede demostrar que fueran copias. Una fuente `skills` ausente
  no dispara bajas.
- El archivo opcional `<perfil>/skills.local` excluye skills completos de las
  copias y bajas. Acepta un nombre de primer nivel por línea, espacios exteriores,
  líneas vacías y comentarios que empiezan con `#`. No acepta rutas ni globs.

Ejemplo de `~/.claude-profiles/kiro/skills.local`:

```text
# Skills mantenidos sólo en este perfil
mi-skill-local
```

Onboarding, confianza del directorio actual y permisos se inicializan como antes.
Settings conserva los valores del perfil y toma del global sólo las opciones
seleccionadas que faltan. MCP combina servidores globales y locales; ante un
nombre repetido gana el perfil. No sincroniza credenciales, historial ni sesiones.
Un JSON inválido detiene el lanzamiento con el nombre del archivo, sin reemplazarlo.

El script compara tamaño, mtime y ctime de origen y destino. Cuando cambian,
compara SHA-256; sólo copia contenido diferente. Tampoco reescribe JSON idénticos.
`install.sh` instala los scripts compartidos antes de actualizar los launchers.
Se necesita Node.js 18 o posterior y Git Bash en Windows.

### Tope por reloj

Las corridas headless (`-p`) tienen un tope de 90 minutos por defecto. Las sesiones
interactivas no tienen tope. Se puede cambiar por corrida o para el entorno:

```bash
claude2bedrock --openai --model luna --effort low --max-minutes 45 -p "despliega y verifica"
CLAUDE2_MAX_MINUTES=30 claude2kiro remote -p "revisa este diff"
```

`--max-minutes <n>` y `CLAUDE2_MAX_MINUTES` requieren un entero positivo; el flag
prevalece sobre la variable. Al llegar al límite, el launcher termina sólo los
procesos de la corrida de Claude Code, espera hasta 20 segundos y fuerza el cierre si
siguen vivos. Escribe
`[claude2all] TIEMPO AGOTADO: <n> min, corrida cortada` en stderr y en
`CLAUDE2ALL_RUN_LOG` cuando ese archivo existe, y devuelve el código 124. Los comandos
administrativos y los procesos `server` no se supervisan, por lo que un `remote` con
tope nunca detiene un proxy compartido.

Para ejecutar sólo el seed, sin credenciales ni inicio de agentes:

```bash
CLAUDE2ALL_SEED_ONLY=1 CLAUDE_CONFIG_DIR=/ruta/al/perfil-de-prueba claude2kimi
CLAUDE2ALL_SEED_ONLY=1 CLAUDE_CONFIG_DIR=/ruta/al/perfil-de-prueba claude2bedrock --openai
node tests/profile-sync.cjs
node tests/profile-sync.cjs "$HOME/.local/bin"
```

El modo seed realiza escrituras reales en el perfil indicado. Fuera de ese modo,
los launchers usan su perfil de backend, sin heredar el perfil de la sesión padre.
Las pruebas crean un HOME temporal dentro de `tests`, cambian una línea de
`CLAUDE.md`, agregan skills y verifican ambos cambios con cada launcher Bash y
cada `.cmd`. También prueban bajas, exclusiones, junctions y la segunda corrida
sin escrituras. Imprimen la ruta de los fixtures para inspección y limpieza.


## Related

- **[sgeraldes/claude2kiro](https://github.com/sgeraldes/claude2kiro)** — the Kiro
  proxy (this repo links to it; it links back here).
- **[sgeraldes/claude2openai](https://github.com/sgeraldes/claude2openai)** — the
  OpenAI proxy: Anthropic Messages API → OpenAI Responses over ChatGPT OAuth.

## License

MIT
