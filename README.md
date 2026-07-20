# claude2all

Run **Claude Code** on every backend and account you have — side by side, without
the sessions ever touching each other. One tiny launcher per backend, each with an
isolated profile (`CLAUDE_CONFIG_DIR`), its own credentials, settings, history, and
model pins.

Windows + Git Bash first (`.cmd` shims included for PowerShell/cmd).

## The roster

| Launcher | Backend | Models loaded | Profile |
|---|---|---|---|
| `claude2kimi` | [Kimi Code](https://www.kimi.com/code/docs) plan | `k3[1m]` main/opus · `kimi-for-coding` sonnet/subagent · `kimi-for-coding-highspeed` haiku | `~/.claude-profiles/kimi` |
| `claude2kiro run` | AWS Kiro via **[claude2kiro](https://github.com/sgeraldes/claude2kiro)** proxy | none pinned — `ANTHROPIC_MODEL=auto` lets Kiro pick per request | `~/.claude-profiles/kiro` |
| `claude2bedrock` | AWS Bedrock (your account, SSO) | opus 4.8 main/opus · sonnet 5 sonnet/subagent · haiku 4.5 (all configurable) | `~/.claude-profiles/bedrock` |
| `claude2openai` | OpenAI Codex models via ChatGPT OAuth (Codex CLI session) | `gpt-5.6-sol` main/opus · `gpt-5.6-terra` sonnet/subagent · `gpt-5.6-luna` haiku | `~/.claude-profiles/openai` |
| `claude2personal` | claude.ai subscription #1 | unpinned (account default, `/model` to change) | `~/.claude-profiles/personal` |
| `claude2work` | claude.ai subscription #2 (team) | unpinned | `~/.claude-profiles/work` |

Your main `claude` command keeps using `~/.claude` — nothing above interferes with it
or with each other. Each wrapper also seeds its profile on launch (merge-only):
`bypassPermissions` default respected from your main settings, workspace trust for
the launch directory, your statusline/UI prefs, global `CLAUDE.md`, custom skills,
and MCP servers.

## Subagents

The `agents/` files register delegation subagents inside any regular Claude Code
session — Claude stays the orchestrator, the backend does the delegated work:

- `kimi-k3` → `claude2kimi -p "<task>"`
- `kiro` → `claude2kiro run -p "<task>"`
- `bedrock` → `claude2bedrock -p "<task>"`
- `openai` → `claude2openai -p "<task>"`

## Install

```bash
git clone https://github.com/sgeraldes/claude2all
cd claude2all
./install.sh
```

Then per backend:

- **`claude2kimi`** — paste your Kimi Code API key into `~/.claude2kimi/config`
  (Kimi Code Console → Create API Key).
- **`claude2bedrock`** — set `AWS_PROFILE` in `~/.claude2bedrock/config` to an SSO
  profile with Bedrock access; first run does `aws sso login` for you. Model IDs must
  be enabled for the *InvokeModel* path on your account (Converse-enabled is not
  enough — see the config comments for the check command).
- **`claude2kiro`** — separate project: **[sgeraldes/claude2kiro](https://github.com/sgeraldes/claude2kiro)**,
  an Anthropic-API→Kiro proxy with login, dashboard, and credits tracking.
  Requires a fix from v1.7.8+ … on Windows, make sure `claude2kiro` resolves the
  native `claude.exe` (see its README).
- **`claude2openai`** — requires the `claude2openai` proxy binary (Anthropic API →
  OpenAI Responses API using the Codex CLI's ChatGPT OAuth session). Build it from
  the sibling project and drop it at `~/.claude2openai/claude2openai.exe`
  (project link coming soon). You must be logged into the Codex CLI
  (`~/.codex/auth.json`).
- **`claude2personal`** — no setup; it imports your existing `~/.claude` login once.
- **`claude2work`** — first run opens browser OAuth; sign in with the second account.

## How it works

Each launcher is a ~60-line bash script: set `CLAUDE_CONFIG_DIR` to an isolated
profile, seed it, export the backend's env vars (endpoint, auth, model pins),
`exec claude "$@"`. No daemons except where the backend needs a protocol proxy
(Kiro, OpenAI). Everything is per-process, so there is no global state to break.

## Related

- **[sgeraldes/claude2kiro](https://github.com/sgeraldes/claude2kiro)** — the Kiro proxy
  referenced above (this repo links to it; it links back here).
- `claude2openai` proxy — Anthropic→OpenAI Responses bridge (repo coming soon).
