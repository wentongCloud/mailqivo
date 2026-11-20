/**
 * §8.3 预览（REST 与 MCP 共用）：临时匹配内容规则 → 生成 AI 区块并写 ai_cache → 完整渲染（追踪 URL 用占位值）。
 * V1.1：返回命中规则、matched_tags 与附件元数据（不读、不返回附件内容）。
 */
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { AiBlock, CONTACT_STATUS_VALUES, ContactFilter, type CampaignPreviewBody, type CampaignPreviewItem } from "@mailqivo/shared";
import { generateContactBlocks, type AiRuleContext } from "../../ai/generate-blocks.ts";
import type { LlmClient } from "../../ai/llm-client.ts";
import type { Db } from "../../db/client.ts";
import { contacts } from "../../db/schema.ts";
import { AppError } from "../../lib/errors.ts";
import { MissingVarError } from "../../render/template.ts";
import { buildContactWhere } from "../contacts/where.ts";
import { getSettings } from "../settings/service.ts";
import { assertRuleAttachments, contactIndustry, contactTagNames, matchContentRule, parseStoredRules } from "./content-rules.ts";
import { renderCampaign } from "./render.ts";
import { getCampaignRow, type CampaignRuntimeConfig } from "./service.ts";

type ContactRow = typeof contacts.$inferSelect;

/** 预览渲染使用的占位 tracking_id（§8.3「追踪 URL 用占位值」）。 */
export const PREVIEW_TRACKING_ID = "00000000-0000-4000-8000-000000000000";

async function pickContacts(db: Db, row: { contact_filter: unknown; content_rules: unknown }, body: CampaignPreviewBody): Promise<ContactRow[]> {
  if (body.contact_ids) {
    const ids = [...new Set(body.contact_ids)];
    const rows = await db.select().from(contacts).where(inArray(contacts.id, ids));
    const byId = new Map(rows.map((contact) => [contact.id, contact]));
    const missing = ids.filter((id) => !byId.has(id));
    if (missing.length) throw new AppError("NOT_FOUND", "联系人不存在", { contact_ids: missing });
    return ids.map((id) => byId.get(id)!);
  }
  // 从当前筛选结果中随机抽取 sample 个 active 联系人（与 send 的收件人口径一致）。
  const filter = { ...ContactFilter.parse(row.contact_filter), statuses: [...CONTACT_STATUS_VALUES] };
  if (body.rule_id) {
    const rules = parseStoredRules(row.content_rules);
    const target = rules.find((rule) => rule.enabled && rule.id === body.rule_id);
    if (!target) throw new AppError("VALIDATION", "请选择已启用的活动内容规则");
    const candidates = and(buildContactWhere(filter), buildContactWhere({
      tags_all: target.tags_all, industry: target.industry || undefined, statuses: ["active"]
    }));
    // A more specific rule can win even when the target's own conditions match.
    const picked: ContactRow[] = [];
    let after: string | undefined;
    while (true) {
      const page: ContactRow[] = await db.select().from(contacts)
        .where(and(candidates, after ? gt(contacts.id, after) : undefined)).orderBy(contacts.id).limit(100);
      if (!page.length) break;
      const tags = await contactTagNames(db, inArray(contacts.id, page.map((contact) => contact.id)));
      for (const contact of page) {
        const match = matchContentRule(rules, tags.get(contact.id) ?? [], contactIndustry(contact.custom_fields));
        if (match?.rule.id === target.id) picked.push(contact);
        if (picked.length === body.sample) return picked;
      }
      after = page.at(-1)!.id;
      if (page.length < 100) break;
    }
    return picked;
  }
  return db.select().from(contacts)
    .where(and(buildContactWhere(filter), eq(contacts.status, "active")))
    .orderBy(sql`random()`)
    .limit(body.sample);
}

export async function previewCampaign(
  db: Db,
  runtime: CampaignRuntimeConfig,
  llm: LlmClient | null,
  id: string,
  body: CampaignPreviewBody
): Promise<CampaignPreviewItem[]> {
  const row = await getCampaignRow(db, id);
  const blocks = AiBlock.array().parse(row.ai_blocks);
  if (blocks.length && !llm) throw new AppError("AI_DISABLED", "活动包含 AI 区块，但尚未配置 LLM_API_KEY");
  // SPEC-GAP: §8.3 未限定活动状态；任何状态都允许预览（只写 ai_cache，不改活动 / message）。
  const picked = await pickContacts(db, row, body);
  if (!picked.length) return [];

  const rules = parseStoredRules(row.content_rules);
  const tagsByContact = rules.length ? await contactTagNames(db, inArray(contacts.id, picked.map((contact) => contact.id))) : new Map<string, string[]>();
  const attachmentsByRule = new Map<string, CampaignPreviewItem["attachments"]>();
  const settings = await getSettings(db);
  const campaign = { id: row.id, ai_goal: row.ai_goal, ai_fields: row.ai_fields, ai_blocks: blocks };

  const items: CampaignPreviewItem[] = [];
  for (const contact of picked) {
    // 预览为样例临时匹配（§8.2「时点」）；正式发送以 preparing 快照为准。
    const match = rules.length ? matchContentRule(rules, tagsByContact.get(contact.id) ?? [], contactIndustry(contact.custom_fields)) : null;
    const rule: AiRuleContext = match ? { id: match.rule.id, instruction: match.rule.instruction, matched_tags: match.matched_tags } : null;
    let attachments: CampaignPreviewItem["attachments"] = [];
    if (match && match.rule.attachment_ids.length) {
      if (!attachmentsByRule.has(match.rule.id)) {
        // 与 send 第一步同一校验（可用、≤10、编码总和）；失败 → VALIDATION。
        const assets = (await assertRuleAttachments(db, runtime, rules, (candidate) => candidate.id === match.rule.id)).get(match.rule.id) ?? [];
        attachmentsByRule.set(match.rule.id, assets.map((asset) => ({ asset_id: asset.id, filename: asset.filename, mime_type: asset.mime_type, size_bytes: asset.size_bytes, sha256: asset.sha256 })));
      }
      attachments = attachmentsByRule.get(match.rule.id)!;
    }

    const warnings: string[] = [];
    const aiContent: Record<string, string> = {};
    const renderAi: Record<string, string> = {};
    if (blocks.length) {
      // SPEC-GAP: LLM 调用在重试耗尽后仍失败（LlmCallError）时规格无对应错误码，直接让请求失败（500），不写缓存。
      const generated = await generateContactBlocks(db, llm!, {
        campaign,
        contact: { id: contact.id, email: contact.email, name: contact.name, company: contact.company, title: contact.title, custom_fields: contact.custom_fields as Record<string, unknown> },
        rule,
        sensitiveWords: settings.sensitive_words,
        useCache: false,
        writeCache: true
      });
      Object.assign(aiContent, generated.content);
      Object.assign(renderAi, generated.content);
      if (!generated.ok) {
        // SPEC-GAP: §8.3 未规定预览时区块两次校验都失败的表现；以 warning 告知（正式发送会 skipped(AI_FAILED)），
        // 渲染用占位文本，不写该区块的缓存。
        warnings.push(`AI 区块 ${generated.block_key} 两次生成均未通过校验（${generated.problems.join("、")}），正式发送将跳过该联系人`);
        for (const block of blocks) if (!(block.key in renderAi)) renderAi[block.key] = `[AI 区块 ${block.key} 生成失败]`;
      }
    }

    let subject = "";
    let html = "";
    let text = "";
    try {
      const rendered = await renderCampaign(db, row, {
        contact: { email: contact.email, name: contact.name, company: contact.company, title: contact.title, custom_fields: contact.custom_fields as Record<string, string> },
        trackingId: PREVIEW_TRACKING_ID,
        preview: true,
        aiContent: renderAi
      }, runtime);
      ({ subject, html, text } = rendered);
      warnings.push(...rendered.warnings);
    } catch (error) {
      if (!(error instanceof MissingVarError)) throw error;
      warnings.push(`缺少变量 ${error.key}，正式发送将跳过该联系人`);
    }
    if (contact.domain_suspect) warnings.push("domain_suspect：该邮箱域名 MX 探测失败，可能无法投递");

    items.push({
      contact: { id: contact.id, email: contact.email, name: contact.name, company: contact.company },
      subject,
      html,
      text,
      ai_content: aiContent,
      warnings,
      content_rule: match ? { id: match.rule.id, name: match.rule.name } : null,
      matched_tags: match ? match.matched_tags : [],
      attachments
    });
  }
  return items;
}
