#!/usr/bin/env bash
# claude2all installer: copies launchers to ~/.local/bin, subagents to
# ~/.claude/agents, and example configs to ~/.claude2<name>/config (only when
# missing — never overwrites an existing config).
set -euo pipefail
cd "$(dirname "$0")"

echo "==> Installing launchers to ~/.local/bin"
mkdir -p "$HOME/.local/bin"
for f in bin/claude2*; do
  cp "$f" "$HOME/.local/bin/"
  [[ "$f" == *.cmd ]] || chmod +x "$HOME/.local/bin/$(basename "$f")"
  echo "    $(basename "$f")"
done

echo "==> Installing subagents to ~/.claude/agents"
mkdir -p "$HOME/.claude/agents"
cp agents/*.md "$HOME/.claude/agents/"
ls agents/*.md | xargs -n1 basename | sed 's/^/    /'

echo "==> Installing example configs (skipped where one exists)"
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

Done. Next steps per backend:
  claude2kimi     -> paste your Kimi Code API key into ~/.claude2kimi/config
  claude2bedrock  -> set AWS_PROFILE in ~/.claude2bedrock/config (SSO login happens on first run)
  claude2kiro     -> separate project: https://github.com/sgeraldes/claude2kiro
  claude2openai   -> needs the claude2openai proxy binary (see README)
  claude2personal -> works immediately if ~/.claude has a claude.ai login
  claude2work     -> first run opens browser OAuth for your second account
EOF
