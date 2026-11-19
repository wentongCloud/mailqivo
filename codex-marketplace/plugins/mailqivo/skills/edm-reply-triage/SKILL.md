---
name: edm-reply-triage
description: Use when the user wants to review, classify, correct, summarize, or mark Mailqivo campaign replies as handled.
---

# Mailqivo 回函甄别

1. 用 `edm_reply_list` 查询 `handled=false` 的回函；用户指定活动时按活动筛选。
2. 对需要阅读的记录调用 `edm_reply_get`。输出《回函处理报告》：人工回复按意向分组，逐条给出事实摘要和建议话术；系统退信和自动回复只汇总数量；`needs_review` 单独列出。
3. 用户指出分类错误时，用 `edm_reply_update` 修正。改为退信时必须提供真实 `reason_code`，不得推测。
4. 仅在用户确认已处理后，将对应回函标记为 `handled=true`。

不得把自动回复当作真实意向，不得隐去需要人工复核的记录。
