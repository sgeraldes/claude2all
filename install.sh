#!/usr/bin/env bash
# claude2all installer: copies launchers to ~/.local/bin, subagents to
# ~/.claude/agents, and example configs to ~/.claude2<name>/config (only when
# missing — never overwrites an existing config).
set -euo pipefail
cd "$(dirname "$0")"

echo "==> Installing launchers to ~/.local/bin"
mkdir -p "$HOME/.local/bin"
# Install the shared helpers before any launcher that calls them.
cp bin/claude2all-profile.cjs bin/claude2all-timeout.cjs "$HOME/.local/bin/"
for f in bin/claude2*; do
  [[ "$f" == *.cjs ]] && continue
  # MSYS cp can resolve an extensionless destination to a running .exe (Kiro).
  # Node uses the exact filename and leaves the proxy binary in place.
  node -e 'const fs=require("fs"),path=require("path");fs.copyFileSync(process.argv[1],path.join(process.argv[2],path.basename(process.argv[1])))' "$f" "$HOME/.local/bin"
  [[ "$f" == *.cmd ]] || chmod +x "$HOME/.local/bin/$(basename "$f")"
  echo "    $(basename "$f")"
done

echo "==> Installing subagents to ~/.claude/agents"
mkdir -p "$HOME/.claude/agents"
cp agents/*.md "$HOME/.claude/agents/"
ls agents/*.md | xargs -n1 basename | sed 's/^/    /'

echo "==> Installing example configs (skipped where one exists)"
mkdir -p "$HOME/.claude2all/examples"
cp config/*.example "$HOME/.claude2all/examples/"
for cfg in config/*.example; do
  name=$(basename "$cfg" .config.example)   # e.g. claude2kimi
  dest_dir="$HOME/.${name}"                  # e.g. ~/.claude2kimi
  mkdir -p "$dest_dir"
  if [[ -f "$dest_dir/config" ]]; then
    echo "    $dest_dir/config exists — kept"
  else
    cp "$cfg" "$dest_dir/config"
    echo "    $dest_dir/config — EDIT THIS (credentials/models)"
  fi
done

cat <<'EOF'

Done. Easiest next step — the setup wizard configures backends interactively
(keys, logins, proxy installs):

  claude2all setup

Or per backend by hand:
  claude2kimi     -> paste your Kimi Code API key into ~/.claude2kimi/config
  claude2bedrock  -> native Claude mode, or --openai for Astra/Sol/Terra over Converse
  claude2kiro     -> separate project: https://github.com/sgeraldes/claude2kiro
  claude2openai   -> needs the claude2openai proxy binary (see README)
  claude2personal -> works immediately if ~/.claude has a claude.ai login
  claude2work     -> first run opens browser OAuth for your second account
EOF
