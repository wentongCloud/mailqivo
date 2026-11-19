/**
 * §6.2 第 5 步 + 第 6 步（V1.1）`sample_confirmed` 唯一实现：
 * - 无 ai_blocks → 恒为 true；
 * - 否则：≥3 个不同**收件人**的全部区块在 ai_cache 中与其当前 instruction_hash 一致，
 *   **且**每条本次至少命中 1 位收件人的启用规则，都至少有 1 位命中该规则的收件人满足上述条件。
 * 按联系人计算 hash：联系人当前 Tags → `matchContentRule`（与 preparing 相同的匹配）→ `blockInstructionHash`。
 */
import { and, eq, inArray } from "drizzle-orm";
import { AiBlock } from "@mailqivo/shared";
import { blockInstructionHash, type AiRuleContext } from "../../ai/generate-blocks.ts";
import type { Db } from "../../db/client.ts";
import { aiCache, contacts } from "../../db/schema.ts";
import { contactIndustry, contactTagNames, matchContentRule, parseStoredRules, type ContentRule } from "./content-rules.ts";
import type { CampaignRow } from "./render.ts";

export const MIN_SAMPLE_CONTACTS = 3;

export type SampleStatus = {
  sample_confirmed: boolean;
  /** 有效样例联系人数（全部区块缓存与当前 hash 一致的收件人）。 */
  sampled_contacts: number;
  /** 有至少 1 位有效样例的启用规则 id。 */
  rules_with_sample: Set<string>;
};

/**
 * @param recipientIds 本次 active 收件人 id（与 summary.recipients 同一快照）。
 * @param tagsByContact 可选：已读取的收件人 Tags；缺省时按需只读有缓存的那几位。
 * @param ruleRecipients 可选：rule.id → 本次命中人数（breakdown）；缺省视为所有启用规则都有收件人。
 */
export async function computeSampleStatus(
  db: Db,
  row: Pick<CampaignRow, "id" | "ai_goal" | "ai_fields" | "ai_blocks" | "content_rules">,
  recipientIds: readonly string[],
  options: { tagsByContact?: Map<string, string[]>; ruleRecipients?: Map<string, number> } = {}
): Promise<SampleStatus> {
  const blocks = AiBlock.array().parse(row.ai_blocks);
  const rules: ContentRule[] = parseStoredRules(row.content_rules);
  if (!blocks.length) return { sample_confirmed: true, sampled_contacts: 0, rules_with_sample: new Set(rules.map((rule) => rule.id)) };

  const recipients = new Set(recipientIds);
  const cacheRows = await db.select().from(aiCache).where(eq(aiCache.campaign_id, row.id));
  const byContact = new Map<string, Map<string, string>>();
  for (const cached of cacheRows) {
    if (!cached.contact_id || !recipients.has(cached.contact_id)) continue;
    const map = byContact.get(cached.contact_id) ?? new Map<string, string>();
    map.set(cached.block_key, cached.instruction_hash);
    byContact.set(cached.contact_id, map);
  }
  const contactIds = [...byContact.keys()];
  let tagsByContact = options.tagsByContact;
  if (!tagsByContact && rules.length && contactIds.length) tagsByContact = await contactTagNames(db, and(inArray(contacts.id, contactIds)));
  const industryByContact = new Map<string, string>();
  if (rules.some((rule) => rule.industry?.trim()) && contactIds.length) {
    const rows = await db.select({ id: contacts.id, custom_fields: contacts.custom_fields }).from(contacts).where(inArray(contacts.id, contactIds));
    for (const row of rows) industryByContact.set(row.id, contactIndustry(row.custom_fields));
  }

  let sampled = 0;
  const rulesWithSample = new Set<string>();
  const campaign = { ai_goal: row.ai_goal, ai_fields: row.ai_fields };
  for (const [contactId, hashes] of byContact) {
    const match = rules.length ? matchContentRule(rules, tagsByContact?.get(contactId) ?? [], industryByContact.get(contactId)) : null;
    const rule: AiRuleContext = match ? { id: match.rule.id, instruction: match.rule.instruction, matched_tags: match.matched_tags } : null;
    const valid = blocks.every((block) => hashes.get(block.key) === blockInstructionHash(campaign, block, rule));
    if (!valid) continue;
    sampled += 1;
    if (match) rulesWithSample.add(match.rule.id);
  }
  const rulesNeeded = rules.filter((rule) => rule.enabled && (options.ruleRecipients ? (options.ruleRecipients.get(rule.id) ?? 0) > 0 : true));
  const everyRuleCovered = rulesNeeded.every((rule) => rulesWithSample.has(rule.id));
  return { sample_confirmed: sampled >= MIN_SAMPLE_CONTACTS && everyRuleCovered, sampled_contacts: sampled, rules_with_sample: rulesWithSample };
}
