#!/bin/zsh
set -euo pipefail

PROJECT_ROOT="${0:A:h:h:h}"
export PATH="${MAILQIVO_RUNTIME_PATH:-/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin}"
PNPM_BIN="${MAILQIVO_PNPM_BIN:-$(command -v pnpm 2>/dev/null || true)}"
[[ -n "$PNPM_BIN" ]] || { print -u2 "pnpm was not found. Run the Codex installer again."; exit 1; }
cd "$PROJECT_ROOT"

for attempt in {1..60}; do
  if node --input-type=module -e '
    import net from "node:net";
    const socket = net.createConnection({ host: "127.0.0.1", port: 5432 });
    socket.once("connect", () => { socket.destroy(); process.exit(0); });
    socket.once("error", () => process.exit(1));
    setTimeout(() => { socket.destroy(); process.exit(1); }, 500);
  '; then
    break
  fi
  if [[ "$attempt" -eq 60 ]]; then
    print -u2 "PostgreSQL did not become ready within 60 seconds."
    exit 1
  fi
  sleep 1
done

exec "$PNPM_BIN" --filter @mailqivo/server start
