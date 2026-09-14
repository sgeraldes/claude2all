# claude2deepseek: Claude Code on a DeepSeek API plan

Date: 2026-09-14. Status: approved by usage (Sebastián asked for the launcher; the shape
follows the existing bridges).

## Goal

Add one more launcher to claude2all so a Claude Code session can spend the DeepSeek API
plan instead of a Claude, Kimi, Kiro, OpenAI or Bedrock subscription. Same contract as the
other bridges: isolated profile, one command, `.cmd` twin, delegation subagent, wizard entry.

## Backend facts (checked 2026-09-14 against api-docs.deepseek.com)

| Item | Value |
|---|---|
| Endpoint | `https://api.deepseek.com/anthropic` (Anthropic Messages API, native) |
| Auth | `ANTHROPIC_AUTH_TOKEN=<DeepSeek API key>`; `x-api-key` also accepted |
| Main model | `deepseek-flash[1m]` (V4.1 Flash, 1M context, 384K output) |
| Second model | `deepseek-v4-pro[1m]` (V4 Pro, 1M context, 384K output, about 4x the price; the API accepts `[1m]` on both models, verified live) |
| Haiku / subagent | `deepseek-flash` |
| Effort | `CLAUDE_CODE_EFFORT_LEVEL=max`; DeepSeek maps it to `reasoning_effort` |
| Windows | `CLAUDE_CODE_AUTO_COMPACT_WINDOW=786432`, hard window 1M |
| Ignored by DeepSeek | `anthropic-beta` header, `top_k`; `top_p` only in thinking mode |
| Legacy names | `deepseek-chat`, `deepseek-reasoner` retired 2026-07-24; `deepseek-v4-flash` routed to V4.1 Flash |

The recipe above is DeepSeek's own Claude Code page; the launcher only wraps it.

## Approaches considered

1. **Direct env launcher, like `claude2kimi`** (chosen). DeepSeek speaks the Anthropic
   protocol, so no proxy binary is needed. Smallest surface, no build step, same failure
   modes as Kimi.
2. **Route through the `claude2openai` proxy with a DeepSeek backend.** Adds a Go change and
   a process for no gain; the proxy exists to translate Anthropic to OpenAI Responses, and
   DeepSeek does not need translating.
3. **Extend `claude2kimi` with a provider switch.** Saves a file but breaks the one-launcher-
   per-subscription rule that the README and the agents rely on.

## Design

- `bin/claude2deepseek`: bash launcher. Seed-only mode, config at `~/.claude2deepseek/config`
  (`DEEPSEEK_API_KEY` required, placeholder rejected), `--model flash|pro|<id>` and
  `--effort low|medium|high|max` parsed before Claude Code sees the args (same shape as
  `claude2bedrock --openai`), profile `~/.claude-profiles/deepseek`, then the official env
  block, then `exec` through `claude2all-timeout.cjs -- claude`.
- `bin/claude2deepseek.cmd`: the usual Git Bash shim.
- `config/claude2deepseek.config.example`: every knob with the verified ids and the source.
- `agents/deepseek.md`: delegation subagent; Flash by default, `--model pro` for hard work.
- `bin/claude2all`: `st_deepseek` probe, `setup_deepseek` step, menu option 7, status row.
- `bin/claude2all-profile.cjs`: `deepseek` joins `kimi` and `openai` in the third-party
  backend flag.
- `install.sh` footer, README (table, subagent list, setup bullet, sync section),
  `.gitattributes` (LF for the new launcher), `tests/profile-sync.cjs` (new launcher in the
  seed matrix).

## Error handling

Missing config, placeholder key, bad `--effort`, and `--model` without a value each exit with
a one-line message and a distinct code (1, 1, 2, 2). Auth failures surface as DeepSeek's own
`authentication_error` JSON through Claude Code; the subagent tells the user to fix the key
and does not retry.

## Testing

- Dry run with a fake `claude` on PATH: every exported variable checked for defaults,
  `--model pro`, raw ids, config overrides, and `--effort` precedence.
- `tests/profile-sync.cjs` runs the new launcher in seed-only mode, Bash and `.cmd`.
- Live: `claude2deepseek -p "Reply with exactly: DEEPSEEK SETUP OK"` and the same with
  `--model pro`, once a key is in the config.
