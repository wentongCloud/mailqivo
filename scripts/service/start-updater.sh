#!/bin/zsh
# launchd 任务 com.mailqivo.updater：只由 API 在两步确认后 kickstart，不随登录启动、不自动重启。
# 运行 .service/updates/current 指向的任务目录中的更新程序副本（版本更新 §4）。
set -euo pipefail

PROJECT_ROOT="${0:A:h:h:h}"
export PATH="${MAILQIVO_RUNTIME_PATH:-/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin}"
TASK_ID="$(cat "$PROJECT_ROOT/.service/updates/current" 2>/dev/null || true)"
[[ "$TASK_ID" =~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' ]] || { print -u2 "No pending Mailqivo update task."; exit 1; }
exec node "$PROJECT_ROOT/.service/updates/$TASK_ID/updater.mjs" "$TASK_ID"
