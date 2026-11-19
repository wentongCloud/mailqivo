#!/bin/zsh
emulate -L zsh
set -euo pipefail

PROJECT_ROOT="${0:A:h:h:h}"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
DOMAIN="gui/$(id -u)"
PNPM_BIN="${MAILQIVO_PNPM_BIN:-$(command -v pnpm 2>/dev/null || true)}"
[[ -n "$PNPM_BIN" ]] || { print -u2 "pnpm was not found."; exit 1; }
NODE_BIN="$(command -v node 2>/dev/null || true)"
[[ -n "$NODE_BIN" ]] || { print -u2 "Node.js was not found."; exit 1; }
RUNTIME_PATH="${MAILQIVO_RUNTIME_PATH:-${NODE_BIN:h}:${PNPM_BIN:h}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin}"
LABELS=(
  com.mailqivo.codex-env
  com.mailqivo.postgres
  com.mailqivo.server
  com.mailqivo.web
)

mkdir -p "$PROJECT_ROOT/.service/logs" "$LAUNCH_AGENTS_DIR"

RENDER_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mailqivo-launchd.XXXXXX")"
trap 'rm -rf "$RENDER_DIR"' EXIT INT TERM

for label in $LABELS; do
  source_plist="$PROJECT_ROOT/ops/launchd/$label.plist"
  rendered_plist="$RENDER_DIR/$label.plist"
  cp "$source_plist" "$rendered_plist"
  case "$label" in
    com.mailqivo.codex-env) script_name="export-codex-env.sh"; log_name="codex-env" ;;
    com.mailqivo.postgres) script_name="start-database.sh"; log_name="postgres" ;;
    com.mailqivo.server) script_name="start-server.sh"; log_name="server" ;;
    com.mailqivo.web) script_name="start-web.sh"; log_name="web" ;;
  esac
  plutil -replace ProgramArguments.1 -string "$PROJECT_ROOT/scripts/service/$script_name" "$rendered_plist"
  plutil -replace WorkingDirectory -string "$PROJECT_ROOT" "$rendered_plist"
  plutil -replace StandardOutPath -string "$PROJECT_ROOT/.service/logs/$log_name.log" "$rendered_plist"
  plutil -replace StandardErrorPath -string "$PROJECT_ROOT/.service/logs/$log_name.error.log" "$rendered_plist"
  plutil -replace EnvironmentVariables -json '{}' "$rendered_plist"
  plutil -insert EnvironmentVariables.PATH -string "$RUNTIME_PATH" "$rendered_plist"
  plutil -insert EnvironmentVariables.MAILQIVO_RUNTIME_PATH -string "$RUNTIME_PATH" "$rendered_plist"
  plutil -insert EnvironmentVariables.MAILQIVO_PNPM_BIN -string "$PNPM_BIN" "$rendered_plist"
  if [[ "$label" == "com.mailqivo.server" ]]; then
    plutil -insert EnvironmentVariables.SERVER_HOST -string "127.0.0.1" "$rendered_plist"
  fi
  plutil -lint "$rendered_plist" >/dev/null
done

for label in com.mailqivo.web com.mailqivo.server com.mailqivo.postgres com.mailqivo.codex-env; do
  /bin/launchctl bootout "$DOMAIN/$label" >/dev/null 2>&1 || true
done

for port in 5432 18090 18091; do
  for attempt in {1..20}; do
    [[ -z "$(lsof -nP -iTCP:$port -sTCP:LISTEN -t 2>/dev/null)" ]] && break
    sleep 0.5
  done
  owner="$(lsof -nP -iTCP:$port -sTCP:LISTEN 2>/dev/null || true)"
  [[ -z "$owner" ]] || { print -u2 "Port $port is already used by another process:\n$owner"; exit 1; }
done

for label in $LABELS; do
  /usr/bin/install -m 0644 \
    "$RENDER_DIR/$label.plist" \
    "$LAUNCH_AGENTS_DIR/$label.plist"
done

/bin/launchctl bootstrap "$DOMAIN" "$LAUNCH_AGENTS_DIR/com.mailqivo.codex-env.plist"
/bin/zsh "$PROJECT_ROOT/scripts/service/export-codex-env.sh"

/bin/launchctl bootstrap "$DOMAIN" "$LAUNCH_AGENTS_DIR/com.mailqivo.postgres.plist"
/bin/launchctl kickstart -k "$DOMAIN/com.mailqivo.postgres"

for attempt in {1..60}; do
  if "$NODE_BIN" --input-type=module -e '
    import net from "node:net";
    const socket = net.createConnection({ host: "127.0.0.1", port: 5432 });
    socket.once("connect", () => { socket.destroy(); process.exit(0); });
    socket.once("error", () => process.exit(1));
    setTimeout(() => { socket.destroy(); process.exit(1); }, 500);
  '; then
    break
  fi
  [[ "$attempt" -lt 60 ]] || { print -u2 "PostgreSQL did not become ready within 60 seconds."; exit 1; }
  sleep 1
done

cd "$PROJECT_ROOT"
"$PNPM_BIN" db:migrate

/bin/launchctl bootstrap "$DOMAIN" "$LAUNCH_AGENTS_DIR/com.mailqivo.server.plist"
/bin/launchctl bootstrap "$DOMAIN" "$LAUNCH_AGENTS_DIR/com.mailqivo.web.plist"
for label in com.mailqivo.server com.mailqivo.web; do
  /bin/launchctl kickstart -k "$DOMAIN/$label"
done
