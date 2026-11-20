#!/bin/zsh
emulate -L zsh
set -euo pipefail

PROJECT_ROOT="${0:A:h:h}"
ENV_FILE="$PROJECT_ROOT/.env"
PLUGIN_ROOT="$PROJECT_ROOT/codex-marketplace/plugins/mailqivo"
MARKETPLACE_ROOT="$PROJECT_ROOT/codex-marketplace"
LOCK_DIR="$PROJECT_ROOT/.service/install.lock"
STARTER_DATA_PENDING="$PROJECT_ROOT/.service/starter-data.pending"
WEB_URL="http://127.0.0.1:18090"
MCP_URL="http://127.0.0.1:18091/mcp"
SKIP_CODEX_RESTART=0

if [[ "${1:-}" == "--no-restart" ]]; then
  SKIP_CODEX_RESTART=1
  shift
fi
(( $# == 0 )) || { print -u2 "Usage: zsh scripts/install-codex.sh [--no-restart]"; exit 2; }

step() { print "\n==> $1"; }
fail() { print -u2 "Installation failed: $1"; exit 1; }

mkdir -p "$PROJECT_ROOT/.service"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  fail "Another Mailqivo installation is already running: $LOCK_DIR"
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT INT TERM

[[ "$(uname -s)" == "Darwin" ]] || fail "The one-step installer currently supports macOS only."
[[ "$EUID" -ne 0 ]] || fail "Run this installer as the current desktop user, not with sudo."

NODE_BIN="$(command -v node 2>/dev/null || true)"
[[ -n "$NODE_BIN" ]] || fail "Node.js was not found. Install Node.js 22.13+ in the 22.x series, or Node.js 24 or later."
NODE_MAJOR="$("$NODE_BIN" -p 'Number(process.versions.node.split(".")[0])')"
NODE_MINOR="$("$NODE_BIN" -p 'Number(process.versions.node.split(".")[1])')"
(( (NODE_MAJOR == 22 && NODE_MINOR >= 13) || NODE_MAJOR >= 24 )) || fail "Node.js 22.13+ or 24+ is required."

PNPM_BIN="$(command -v pnpm 2>/dev/null || true)"
if [[ -z "$PNPM_BIN" ]] && command -v corepack >/dev/null 2>&1; then
  corepack enable
  PNPM_BIN="$(command -v pnpm 2>/dev/null || true)"
fi
[[ -n "$PNPM_BIN" ]] || fail "pnpm was not found. Install pnpm 11 or later."
PNPM_MAJOR="$("$PNPM_BIN" --version | cut -d. -f1)"
(( PNPM_MAJOR >= 11 )) || fail "pnpm 11 or later is required."

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
[[ -n "$CODEX_BIN" ]] || fail "Codex CLI was not found. Install and launch the latest Codex or ChatGPT desktop app first."

step "Checking existing Mailqivo installation"
MARKETPLACES_JSON="$("$CODEX_BIN" plugin marketplace list --json)"
REGISTERED_ROOT="$(print -r -- "$MARKETPLACES_JSON" | "$NODE_BIN" -e '
  let input=""; process.stdin.on("data", d => input += d).on("end", () => {
    const item=JSON.parse(input).marketplaces.find(x => x.name === "mailqivo-local");
    process.stdout.write(item?.root || "");
  });
')"
if [[ -n "$REGISTERED_ROOT" && "${REGISTERED_ROOT:A}" != "${MARKETPLACE_ROOT:A}" ]]; then
  fail "mailqivo-local already points to another directory: $REGISTERED_ROOT"
fi
for service in codex-env postgres server web updater; do
  service_plist="$HOME/Library/LaunchAgents/com.mailqivo.$service.plist"
  [[ -e "$service_plist" || -L "$service_plist" ]] || continue
  service_root="$(/usr/bin/plutil -extract WorkingDirectory raw -o - "$service_plist")" || \
    fail "Cannot determine the installation directory for $service_plist"
  [[ -n "$service_root" && "${service_root:A}" == "$PROJECT_ROOT" ]] || \
    fail "The existing Mailqivo $service service belongs to another installation: $service_root"
done

check_service_port() {
  local port="$1" service="$2" pid job_pid parent_pid listeners
  local plist="$HOME/Library/LaunchAgents/com.mailqivo.$service.plist"
  listeners="$(/usr/sbin/lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null)" || {
    [[ "$?" == 1 && -z "$listeners" ]] && return 0
    fail "Could not check TCP port $port."
  }
  # launchd owns the wrapper, while PostgreSQL and Next.js may listen from a child.
  job_pid="$(/bin/launchctl print "gui/$(id -u)/com.mailqivo.$service" 2>/dev/null |
    /usr/bin/awk '$1 == "pid" && $2 == "=" && !found { print $3; found=1 }')" || job_pid=""
  [[ -f "$plist" && "$job_pid" == <1-> ]] || fail "TCP port $port is in use outside this installation."
  for pid in ${(f)listeners}; do
    while [[ "$pid" != "$job_pid" ]]; do
      [[ "$pid" == <2-> ]] || fail "TCP port $port is in use outside this installation."
      parent_pid="$(/bin/ps -o ppid= -p "$pid" 2>/dev/null)" || fail "Could not verify the owner of TCP port $port."
      pid="${parent_pid//[[:space:]]/}"
    done
  done
}
check_service_port 5432 postgres
check_service_port 18090 web
check_service_port 18091 server

for required in package.json pnpm-lock.yaml .env.example \
  apps/web/public/images/extra/image4.jpg \
  codex-marketplace/.agents/plugins/marketplace.json \
  codex-marketplace/plugins/mailqivo/.codex-plugin/plugin.json \
  codex-marketplace/plugins/mailqivo/.mcp.json \
  scripts/service/install-macos.sh demo/config.mjs demo/seed.mjs; do
  [[ -f "$PROJECT_ROOT/$required" ]] || fail "Required file is missing: $required"
done

"$NODE_BIN" "$PROJECT_ROOT/scripts/check-installation.mjs"

step "Validating the minimal plugin package"
typeset -a EXPECTED_PLUGIN_FILES ACTUAL_PLUGIN_FILES
EXPECTED_PLUGIN_FILES=(
  .codex-plugin/plugin.json
  .mcp.json
  assets/logo.png
  skills/edm-personalize/SKILL.md
  skills/edm-reply-triage/SKILL.md
)
ACTUAL_PLUGIN_FILES=("${(@f)$(cd "$PLUGIN_ROOT" && find . -type f -print | sed 's#^\./##' | LC_ALL=C sort)}")
(( ${#ACTUAL_PLUGIN_FILES[@]} == ${#EXPECTED_PLUGIN_FILES[@]} )) || \
  fail "The plugin package must contain exactly five runtime files. Documentation, source code, tests, dependencies, logs, and secrets are not allowed."
for (( index = 1; index <= ${#EXPECTED_PLUGIN_FILES[@]}; index++ )); do
  [[ "${ACTUAL_PLUGIN_FILES[$index]}" == "${EXPECTED_PLUGIN_FILES[$index]}" ]] || \
    fail "The plugin file allowlist does not match: ${ACTUAL_PLUGIN_FILES[$index]}"
done
[[ -z "$(find "$PLUGIN_ROOT" -type l -print -quit)" ]] || fail "Symbolic links are not allowed in the plugin package."
[[ ! -e "$PLUGIN_ROOT/plugin.json" && ! -e "$PLUGIN_ROOT/mcp.json" ]] || \
  fail "This Codex version uses the compatibility manifests. Do not add root manifests that shadow the MCP configuration."

"$NODE_BIN" -e '
  const fs = require("node:fs");
  const [marketFile, pluginFile, mcpFile] = process.argv.slice(1);
  const market = JSON.parse(fs.readFileSync(marketFile, "utf8"));
  const plugin = JSON.parse(fs.readFileSync(pluginFile, "utf8"));
  const mcp = JSON.parse(fs.readFileSync(mcpFile, "utf8"));
  const server = mcp.mcpServers?.mailqivo;
  if (market.name !== "mailqivo-local") throw new Error("The marketplace name must be mailqivo-local");
  if (plugin.name !== "mailqivo" || plugin.mcpServers !== "./.mcp.json") throw new Error("The plugin compatibility manifest is invalid");
  if (server?.url !== "http://127.0.0.1:18091/mcp" || server?.bearer_token_env_var !== "MCP_TOKEN") {
    throw new Error("The MCP URL or authentication variable is invalid");
  }
' "$MARKETPLACE_ROOT/.agents/plugins/marketplace.json" \
  "$PLUGIN_ROOT/.codex-plugin/plugin.json" "$PLUGIN_ROOT/.mcp.json"

env_value() {
  local key="$1"
  /usr/bin/awk -v key="$key" 'index($0, key "=") == 1 { value=substr($0, length(key) + 2) } END { print value }' "$ENV_FILE"
}

set_env_value() {
  local key="$1" value="$2" temp_file
  temp_file="$(mktemp "$PROJECT_ROOT/.env.tmp.XXXXXX")"
  /usr/bin/awk -v key="$key" -v value="$value" '
    BEGIN { found=0 }
    index($0, key "=") == 1 { if (!found) print key "=" value; found=1; next }
    { print }
    END { if (!found) print key "=" value }
  ' "$ENV_FILE" > "$temp_file"
  chmod 0600 "$temp_file"
  mv "$temp_file" "$ENV_FILE"
}

random_hex() { "$NODE_BIN" -e "process.stdout.write(require('node:crypto').randomBytes($1).toString('hex'))"; }
random_base64() { "$NODE_BIN" -e "process.stdout.write(require('node:crypto').randomBytes($1).toString('base64'))"; }

step "Preparing secure local configuration"
if [[ ! -f "$ENV_FILE" ]]; then
  cp "$PROJECT_ROOT/.env.example" "$ENV_FILE"
fi
chmod 0600 "$ENV_FILE"
set_env_value PUBLIC_BASE_URL "$WEB_URL"
set_env_value SERVER_PORT "18091"
set_env_value SERVER_INTERNAL_URL "http://127.0.0.1:18091"

value="$(env_value DATABASE_URL)"
if [[ -z "$value" ]]; then
  set_env_value DATABASE_URL "postgresql://mailqivo:$(random_hex 24)@127.0.0.1:5432/mailqivo"
fi

value="$(env_value APP_ENCRYPTION_KEY)"
[[ -n "$value" && "$value" != change-me* ]] || set_env_value APP_ENCRYPTION_KEY "$(random_base64 32)"
value="$(env_value SESSION_SECRET)"
[[ -n "$value" && "$value" != change-me* ]] || set_env_value SESSION_SECRET "$(random_hex 32)"
value="$(env_value MCP_TOKEN)"
[[ -n "$value" && "$value" != change-me* ]] || set_env_value MCP_TOKEN "$(random_hex 32)"
value="$(env_value ADMIN_PASSWORD)"
if [[ -z "$value" || "$value" == change-me* ]]; then
  set_env_value ADMIN_PASSWORD "$(random_hex 12)"
fi
MCP_TOKEN_VALUE="$(env_value MCP_TOKEN)"
[[ -n "$MCP_TOKEN_VALUE" ]] || fail "MCP_TOKEN could not be generated."
mkdir -p "$PROJECT_ROOT/data/assets" "$PROJECT_ROOT/.service/logs"

step "Installing dependencies and building Mailqivo"
cd "$PROJECT_ROOT"
"$PNPM_BIN" install --frozen-lockfile
"$PNPM_BIN" --filter @mailqivo/server typecheck
"$PNPM_BIN" --filter @mailqivo/web exec next build --webpack
"$PNPM_BIN" --filter @mailqivo/server exec tsx -e \
  'import "./src/env.ts"; import { loadConfig } from "./src/config.ts"; loadConfig();'

step "Installing and starting background services"
if [[ ! -e "$PROJECT_ROOT/.pgdata/PG_VERSION" ]]; then
  touch "$STARTER_DATA_PENDING"
fi
MAILQIVO_PNPM_BIN="$PNPM_BIN" \
MAILQIVO_RUNTIME_PATH="${NODE_BIN:h}:${PNPM_BIN:h}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" \
  /bin/zsh "$PROJECT_ROOT/scripts/service/install-macos.sh"

/bin/launchctl setenv MCP_TOKEN "$MCP_TOKEN_VALUE"
[[ "$(/bin/launchctl getenv MCP_TOKEN)" == "$MCP_TOKEN_VALUE" ]] || \
  fail "MCP_TOKEN could not be added to the Codex desktop session."

wait_http() {
  local name="$1" url="$2" expected="$3" code="" attempt
  for attempt in {1..60}; do
    code="$(curl -sS -o /dev/null --max-time 2 -w '%{http_code}' "$url" 2>/dev/null || true)"
    if [[ "$code" == "$expected" ]]; then
      return 0
    fi
    sleep 1
  done
  fail "$name did not become ready: $url (HTTP ${code:-000})"
}

wait_http "Mailqivo API" "http://127.0.0.1:18091/healthz" "200"
wait_http "Mailqivo Web" "http://127.0.0.1:18090/login" "200"
wait_http "Mailqivo login image" "$WEB_URL/images/extra/image4.jpg" "200"
if [[ -f "$STARTER_DATA_PENDING" ]]; then
  step "Loading starter data"
  "$NODE_BIN" "$PROJECT_ROOT/demo/seed.mjs" --install
  rm "$STARTER_DATA_PENDING"
fi

cd "$PROJECT_ROOT/apps/server"
MCP_TOKEN="$MCP_TOKEN_VALUE" "$NODE_BIN" --input-type=module -e '
  import { Client } from "@modelcontextprotocol/sdk/client/index.js";
  import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
  const client = new Client({ name: "mailqivo-installer", version: "1.0.0" });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL("http://127.0.0.1:18091/mcp"), {
      requestInit: { headers: { authorization: `Bearer ${process.env.MCP_TOKEN}` } }
    }));
    const { tools } = await client.listTools();
    const workspace = tools.find((tool) => tool.name === "edm_workspace_open");
    const openWeb = tools.find((tool) => tool.name === "edm_workspace_open_web");
    const resourceUri = workspace?._meta?.ui?.resourceUri;
    const isGlobal = workspace?._meta?.["openai/ui"]?.entrypoints?.some((entry) => entry.type === "global");
    if (!workspace || !openWeb || !resourceUri || !isGlobal) throw new Error("The global workspace entry metadata is incomplete");
    const { resources } = await client.listResources();
    if (!resources.some((resource) => resource.uri === resourceUri)) throw new Error("The workspace resource is not registered");
    const resource = await client.readResource({ uri: resourceUri });
    if (!resource.contents?.some((item) => typeof item.text === "string" && item.text.includes("tools/call"))) {
      throw new Error("The workspace resource content is invalid");
    }
    await client.callTool({ name: "edm_workspace_open", arguments: {} });
  } finally {
    await client.close().catch(() => {});
  }
'
cd "$PROJECT_ROOT"

step "Registering the Mailqivo plugin"
if [[ -z "$REGISTERED_ROOT" ]]; then
  "$CODEX_BIN" plugin marketplace add "$MARKETPLACE_ROOT" --json >/dev/null
fi

SOURCE_VERSION="$("$NODE_BIN" -p 'require(process.argv[1]).version' "$PLUGIN_ROOT/.codex-plugin/plugin.json")"
"$NODE_BIN" -e '
  if (!/^\d+\.\d+\.\d+$/.test(process.argv[1])) throw new Error("The plugin version must use strict semantic versioning");
' "$SOURCE_VERSION"
PLUGINS_JSON="$("$CODEX_BIN" plugin list --json)"
INSTALLED_VERSION="$(print -r -- "$PLUGINS_JSON" | "$NODE_BIN" -e '
  let input=""; process.stdin.on("data", d => input += d).on("end", () => {
    const item=JSON.parse(input).installed.find(x => x.pluginId === "mailqivo@mailqivo-local");
    process.stdout.write(item?.version || "");
  });
')"

compare_plugin_tree() {
  local target="$1" relative
  [[ -d "$target" ]] || return 1
  [[ -z "$(find "$target" -type l -print -quit)" ]] || return 1
  local -a files=("${(@f)$(cd "$target" && find . -type f -print | sed 's#^\./##' | LC_ALL=C sort)}")
  (( ${#files[@]} == ${#EXPECTED_PLUGIN_FILES[@]} )) || return 1
  for relative in $EXPECTED_PLUGIN_FILES; do
    [[ -f "$target/$relative" ]] || return 1
    cmp -s "$PLUGIN_ROOT/$relative" "$target/$relative" || return 1
  done
}

CACHE_ROOT="$HOME/.codex/plugins/cache/mailqivo-local/mailqivo/$SOURCE_VERSION"
if [[ -n "$INSTALLED_VERSION" && "$INSTALLED_VERSION" == "$SOURCE_VERSION" ]]; then
  compare_plugin_tree "$CACHE_ROOT" || \
    fail "Plugin contents changed without a version change from $SOURCE_VERSION. Increase the plugin version before installation."
else
  if [[ -n "$INSTALLED_VERSION" ]]; then
    VERSION_ORDER="$("$NODE_BIN" -e '
      const a=process.argv[1].split(".").map(Number), b=process.argv[2].split(".").map(Number);
      if (a.length !== 3 || b.length !== 3 || [...a,...b].some(Number.isNaN)) process.exit(2);
      process.stdout.write(String(a[0]-b[0] || a[1]-b[1] || a[2]-b[2]));
    ' "$SOURCE_VERSION" "$INSTALLED_VERSION")"
    (( VERSION_ORDER > 0 )) || fail "Installed version $INSTALLED_VERSION is newer than or equal to source version $SOURCE_VERSION. Downgrades are not allowed."
  fi
  "$CODEX_BIN" plugin add mailqivo@mailqivo-local --json >/dev/null
fi
compare_plugin_tree "$CACHE_ROOT" || fail "The plugin cache is missing, contains extra files, or does not match the source package."

PLUGINS_JSON="$("$CODEX_BIN" plugin list --json)"
print -r -- "$PLUGINS_JSON" | "$NODE_BIN" -e '
  let input=""; process.stdin.on("data", d => input += d).on("end", () => {
    const data=JSON.parse(input), expected=process.argv[1];
    const item=data.installed.find(x => x.pluginId === "mailqivo@mailqivo-local");
    if (!item || !item.installed || !item.enabled || item.version !== expected) process.exit(1);
  });
' "$SOURCE_VERSION" || fail "Codex plugin installation verification failed."

step "Refreshing Codex"
if (( ! SKIP_CODEX_RESTART )); then
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
fi

if (( SKIP_CODEX_RESTART )); then
  print "\nMailqivo services are ready. Fully quit and reopen Codex to refresh its connection."
else
  print "\nMailqivo installation completed."
fi
print "Web console: $WEB_URL/"
print "MCP: $MCP_URL"
print "Codex navigation: Mailqivo"
print -r -- "For web sign-in, use the ADMIN_PASSWORD value in $ENV_FILE."
