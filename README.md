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
claude2deepseek    # Claude Code, powered by your DeepSeek API plan
claude2openai      # Claude Code, powered by your ChatGPT subscription (gpt-5.6)
claude2work        # Claude Code on your second claude.ai subscription
```

## Way 1: Standalone (in your terminal)

Each launcher is a full Claude Code session on that backend — anything `claude`
accepts works:

```bash
claude2kimi                          # interactive session
claude2kimi -p "explain src/api/"    # one-shot headless answer
claude2openai --resume               # resume last session (per-profile history)
```

| Launcher | Backend | Models it loads |
|---|---|---|
| `claude2kimi` | [Kimi Code](https://www.kimi.com/code/docs) plan | `k3[1m]` main · `kimi-for-coding` sonnet · `kimi-for-coding-highspeed` haiku |
| `claude2deepseek` | [DeepSeek](https://api-docs.deepseek.com) API plan (Anthropic-compatible endpoint) | `deepseek-flash[1m]` main · `deepseek-flash` haiku and subagents · `--model pro` for `deepseek-v4-pro[1m]`; `--effort` |
| `claude2kiro run` | AWS Kiro via **[claude2kiro](https://github.com/sgeraldes/claude2kiro)** | nothing pinned — `auto`, Kiro picks per request |
| `claude2openai` | OpenAI via ChatGPT OAuth (Codex CLI session) | `gpt-5.6-sol` main · `gpt-5.6-terra` sonnet · `gpt-5.6-luna` haiku |
| `claude2personal` | claude.ai subscription #1 | unpinned (account default; `/model` to change) |
| `claude2work` | claude.ai subscription #2 (team) | unpinned |

`claude2bedrock` was retired on 2026-09-21. It spent an AWS account instead of a
subscription (2,768 USD in September against 69 in August), and an SCP now denies every
billable Bedrock call on that account. The launcher only prints why; its subagent is gone,
and `install.sh` parks a copy left by an older install.

## Way 2: Inside Claude Code (subagents)

The installer also drops delegation subagents into `~/.claude/agents/`. Inside any
regular Claude Code session you just ask in natural language:

```
> use the kimi-k3 subagent to review src/auth.ts
> have the openai subagent write the terraform for an S3 bucket
```

Claude stays the orchestrator; the named backend does the delegated work headlessly
(`claude2<backend> -p "<task>"`) and returns its output. Available subagents:
`kimi-k3`, `deepseek`, `kiro`, `openai`. Check `/agents` in a session to see them.

## Setup per backend

- **`claude2kimi`** — paste your Kimi Code API key into `~/.claude2kimi/config`
  (Kimi Code Console → Create API Key).
- **`claude2deepseek`** — paste your DeepSeek API key into `~/.claude2deepseek/config`
  (https://platform.deepseek.com/api_keys). DeepSeek serves the Anthropic Messages API
  natively at `https://api.deepseek.com/anthropic`, so there is no proxy. Defaults follow
  DeepSeek's own Claude Code recipe: `deepseek-flash[1m]` for the main, opus and sonnet
  slots, plain `deepseek-flash` for haiku and subagents, effort `max`, auto-compact at
  768K tokens. `--model flash|pro|<id>` switches the main model (`pro` is
  `deepseek-v4-pro[1m]`, about four times the price of Flash); `--effort low|medium|high|max`
  overrides the effort; everything after a literal `--` goes to Claude Code untouched. Every
  value can also be pinned in the config file. `tests/claude2deepseek.cjs` runs the launcher
  against a fake `claude` and checks every exported variable and exit code.
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
The launchers write nothing to the source `~/.claude`; only `install.sh` adds the
subagents under `~/.claude/agents`.

## Perfiles: sincronización en cada lanzamiento

`claude2kiro`, `claude2openai`, `claude2kimi` y `claude2deepseek` sincronizan las
instrucciones antes de iniciar Claude Code. `claude2personal` y `claude2work` mantienen
su seed propio.
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
claude2openai --max-minutes 45 -p "despliega y verifica"
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

El helper no agrega texto al prompt ni filtra la salida. Al vencer, busca los procesos
de Claude Code que descienden de la corrida y los termina; si Claude Code todavía no
arrancó (login SSO, arranque del proxy), termina la corrida misma. Ctrl-C sobre el
launcher hace lo mismo. Tienen tope `claude2kiro`, `claude2openai`, `claude2kimi` y
`claude2deepseek`; `claude2personal` y `claude2work` no pasan por el helper.
La variable `CLAUDE2ALL_TIMEOUT_ACTIVE` sólo vive entre el helper y el launcher que lo
llamó; Claude Code y los proxies no la heredan, así que un launcher anidado recibe su
propio tope. Con `CLAUDE2ALL_DEBUG=1` el helper escribe en stderr cada fase del corte con
su tiempo (consulta del árbol, cierre, gracia, fuerza).

### Corridas headless sin MCP

Una corrida `-p` es trabajo delegado: el helper le agrega `--strict-mcp-config`, así que
arranca sin servidores MCP. Cada servidor que carga una corrida es un árbol de procesos
propio; el 25-sep-2026, con varias corridas en paralelo, la máquina llegó a 254 procesos
MCP y 9 GB. Se recuperan cuando hacen falta:

```bash
claude2kimi --mcp-config .mcp.json -p "usa el MCP de este repo"   # sólo los de ese archivo
CLAUDE2ALL_MCP=all claude2openai -p "necesito Slack y Kantata"    # todos, como antes
```

Un `--strict-mcp-config` propio no se duplica. Las sesiones interactivas no cambian. El helper
lee los argumentos como opciones con sus valores: `-p`, `--print` y `--print=true` cuentan como
headless; un `-p` que es el valor de otra opción (`--append-system-prompt -p`) no. El flag va
adelante de los argumentos de Claude Code, nunca entre una opción y su valor.

Para ejecutar sólo el seed, sin credenciales ni inicio de agentes:

```bash
CLAUDE2ALL_SEED_ONLY=1 CLAUDE_CONFIG_DIR=/ruta/al/perfil-de-prueba claude2kimi
node tests/profile-sync.cjs
node tests/profile-sync.cjs "$HOME/.local/bin"
node tests/claude2deepseek.cjs
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
