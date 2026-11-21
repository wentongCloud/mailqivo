---
name: edm-personalize
description: Use when the user wants to create, personalize, preview, schedule, or send a Mailqivo email campaign.
---

# Mailqivo 个性化活动

1. 确认活动目标、单一目标客群、联系人筛选条件和基础模板。不同客群分别创建活动。
2. 用 `edm_contact_search` 核对人数、标签和可用字段。有效联系人为 0 时不创建活动，请用户先调整客群或通讯录。仅在用户确认后把字段加入 `ai_fields`。
3. 创建活动。只有用户需要按收件人生成个性化段落时，才设计 1–3 个 AI 区块；普通活动不配置 AI 区块，也不询问个性化指令。需要差异化正文或附件时，先查询或上传附件，再配置 `content_rules`；标签更具体的规则优先。
4. 活动有 AI 区块时，用 `edm_campaign_preview` 生成 3–5 个样例，完整展示收件人、主题、正文、规则、标签、附件和警告，并根据用户反馈更新活动后重新预览。每条实际命中收件人的启用规则都必须有样例；缺样例的规则用 `rule_id` 单独补齐。活动没有 AI 区块时跳过本步。
5. 发送前先调用不带 `confirm_token` 的 `edm_campaign_send`，完整展示返回的收件人数、跳过原因、通道余量、预计天数、样例状态、规则分布和提示。
6. 只有用户针对该摘要明确同意后，才可带返回的 `confirm_token` 再次调用。返回 `CONFIRM_INVALID` 时令牌已作废，须重新取得摘要并再次征得同意；返回 `CHANNEL_ERROR` 时活动仍为草稿，请用户修复通道后重新取得摘要。不得编造联系人事实、跳过样例或代替用户确认。

附件经 MCP 上传时解码后不得超过 5 MB；更大的文件让用户在 `http://localhost:18090` 上传。
