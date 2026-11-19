#!/bin/zsh
set -euo pipefail

PROJECT_ROOT="${0:A:h:h:h}"
MCP_TOKEN="$(/usr/bin/awk 'index($0, "MCP_TOKEN=") == 1 { value=substr($0, 11) } END { print value }' "$PROJECT_ROOT/.env")"

if [[ -z "${MCP_TOKEN:-}" ]]; then
  print -u2 "MCP_TOKEN is not configured."
  exit 1
fi

/bin/launchctl asuser "$(id -u)" /bin/launchctl setenv MCP_TOKEN "$MCP_TOKEN"
