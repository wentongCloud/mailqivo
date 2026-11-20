#!/bin/zsh
emulate -L zsh
set -euo pipefail

PROJECT_ROOT="${0:A:h:h}"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
DOMAIN="gui/$(id -u)"
LABELS=(
  com.mailqivo.codex-env
  com.mailqivo.postgres
  com.mailqivo.server
  com.mailqivo.web
  com.mailqivo.updater
)

find_codex() {
  local candidate
  if [[ -n "${CODEX_CLI_PATH:-}" && -x "$CODEX_CLI_PATH" ]]; then
    print -r -- "$CODEX_CLI_PATH"
    return
  fi
  candidate="$(command -v codex 2>/dev/null || true)"
  if [[ -n "$candidate" ]]; then
    print -r -- "$candidate"
    return
  fi
  for candidate in \
    "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex" \
    "/Applications/Codex.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex" \
    "$HOME/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex" \
    "$HOME/Applications/Codex.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex"; do
    if [[ -x "$candidate" ]]; then
      print -r -- "$candidate"
      return
    fi
  done
}

CODEX_BIN="$(find_codex)"
NODE_BIN="$(command -v node 2>/dev/null || true)"

if [[ -n "$CODEX_BIN" && -n "$NODE_BIN" ]]; then
  PLUGINS_JSON="$("$CODEX_BIN" plugin list --json)"
  IS_INSTALLED="$(print -r -- "$PLUGINS_JSON" | "$NODE_BIN" -e '
    let input=""; process.stdin.on("data", d => input += d).on("end", () => {
      const item=JSON.parse(input).installed.find(x => x.pluginId === "mailqivo@mailqivo-local");
      process.stdout.write(item ? "1" : "0");
    });
  ')"
  if [[ "$IS_INSTALLED" == "1" ]]; then
    "$CODEX_BIN" plugin remove mailqivo@mailqivo-local --json >/dev/null
  fi

  MARKETPLACES_JSON="$("$CODEX_BIN" plugin marketplace list --json)"
  REGISTERED_ROOT="$(print -r -- "$MARKETPLACES_JSON" | "$NODE_BIN" -e '
    let input=""; process.stdin.on("data", d => input += d).on("end", () => {
      const item=JSON.parse(input).marketplaces.find(x => x.name === "mailqivo-local");
      process.stdout.write(item?.root || "");
    });
  ')"
  if [[ -n "$REGISTERED_ROOT" && "${REGISTERED_ROOT:A}" == "${PROJECT_ROOT:A}/codex-marketplace" ]]; then
    "$CODEX_BIN" plugin marketplace remove mailqivo-local --json >/dev/null
  elif [[ -n "$REGISTERED_ROOT" ]]; then
    print -u2 "The mailqivo-local marketplace points to another repository and was not removed: $REGISTERED_ROOT"
  fi
else
  print -u2 "Codex CLI or Node.js was not found. The plugin registration could not be removed automatically."
fi

for label in com.mailqivo.updater com.mailqivo.web com.mailqivo.server com.mailqivo.postgres com.mailqivo.codex-env; do
  /bin/launchctl bootout "$DOMAIN/$label" >/dev/null 2>&1 || true
done
for label in $LABELS; do
  /bin/rm -f "$LAUNCH_AGENTS_DIR/$label.plist"
done
/bin/launchctl unsetenv MCP_TOKEN >/dev/null 2>&1 || true

APP_NAME=""
[[ -d "/Applications/ChatGPT.app" || -d "$HOME/Applications/ChatGPT.app" ]] && APP_NAME="ChatGPT"
[[ -z "$APP_NAME" && ( -d "/Applications/Codex.app" || -d "$HOME/Applications/Codex.app" ) ]] && APP_NAME="Codex"
if [[ -n "$APP_NAME" ]]; then
  /usr/bin/osascript -e "tell application \"$APP_NAME\" to quit" >/dev/null 2>&1 || true
  for attempt in {1..30}; do
    pgrep -x "$APP_NAME" >/dev/null 2>&1 || break
    sleep 1
  done
  /usr/bin/open -a "$APP_NAME"
fi

print "Mailqivo has been uninstalled."
print "Local configuration and data were preserved in:"
print "  $PROJECT_ROOT/.env"
print "  $PROJECT_ROOT/.pgdata"
print "  $PROJECT_ROOT/data"
