#!/bin/zsh
set -euo pipefail

PROJECT_ROOT="${0:A:h:h:h}"
export PATH="${MAILQIVO_RUNTIME_PATH:-/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin}"
PNPM_BIN="${MAILQIVO_PNPM_BIN:-$(command -v pnpm 2>/dev/null || true)}"
[[ -n "$PNPM_BIN" ]] || { print -u2 "pnpm was not found. Run the Codex installer again."; exit 1; }
cd "$PROJECT_ROOT"

exec "$PNPM_BIN" --filter @mailqivo/web exec next start -p 18090 -H 127.0.0.1
