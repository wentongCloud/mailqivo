/**
 * §8.2 AI 区块生成（唯一实现）：白名单字段 → 提示词 → LLM → 校验（失败重新生成 1 次）→ ai_cache。
 * V1.1：命中内容规则时只把该规则的 `matched_tags` 与 `instruction` 写进提示词与缓存键；
 * 匹配本身只由 `modules/campaigns/content-rules.ts` 的 `matchContentRule` 完成（预览临时匹配，
 * 正式发送读 `messages.content_rule_snapshot`），这里不做匹配。
 */
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { AiBlock } from "@mailqivo/shared";
import type { Db } from "../db/client.ts";
import { aiCache } from "../db/schema.ts";
import { stableStringify } from "../lib/confirm-token.ts";
import type { LlmClient } from "./llm-client.ts";
import { blockSystemPrompt, blockUserPrompt } from "./prompts.ts";

/** 参与生成的活动字段。 */
export type AiCampaign = {
  id: string;
  ai_goal: string | null;
  ai_fields: string[];
  ai_blocks: AiBlock[];
};

/** 该联系人命中的规则（来自 matchContentRule 或 content_rule_snapshot）；未命中为 null。 */
export type AiRuleContext = { id: string; instruction: string; matched_tags: string[] } | null;

export type AiContact = {
  id: string;
  email: string;
  name: string | null;
  company: string | null;
  title: string | null;
  custom_fields: Record<string, unknown>;
};

/**
 * §3 / V1.1 §3.8 缓存键：sha256(ai_goal + block.instruction + max_chars + ai_fields + rule.id + rule.instruction + 排序后的 matched_tags)；
 * 无命中时规则部分为空串。只纳入**该联系人命中的规则**，修改其他规则不影响。
 * 各段以稳定 JSON 序列化后再求哈希，避免直接拼接产生的边界歧义。
 */
export function blockInstructionHash(campaign: Pick<AiCampaign, "ai_goal" | "ai_fields">, block: AiBlock, rule: AiRuleContext): string {
  const payload = {
    ai_goal: campaign.ai_goal ?? "",
    instruction: block.instruction,
    max_chars: block.max_chars,
    ai_fields: campaign.ai_fields,
    rule_id: rule?.id ?? "",
    rule_instruction: rule?.instruction ?? "",
    matched_tags: rule ? [...rule.matched_tags].sort().join("\u0000") : ""
  };
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

const BUILTIN_FIELDS: Record<string, "name" | "company" | "title" | "email"> = {
  name: "name", 姓名: "name",
  company: "company", 公司: "company",
  title: "title", 职位: "title",
  email: "email", 邮箱: "email"
};

/**
 * §8.2「只传白名单字段」：按 ai_fields 顺序取联系人字段，内置字段（name/company/title/email 及中文别名）
 * 取列值，其余取 custom_fields[key]；空值不传。联系人的 Tags 永远不在这里出现。
 */
export function pickContactFields(contact: AiContact, aiFields: readonly string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of aiFields) {
    const builtin = BUILTIN_FIELDS[key];
    const raw = builtin ? contact[builtin] : contact.custom_fields[key];
    if (raw === null || raw === undefined) continue;
    const value = String(raw).trim();
    if (value) result[key] = value;
  }
  return result;
}

export type BlockProblem = "INVALID_JSON" | "EMPTY" | "TOO_LONG" | "SENSITIVE_WORD";

/** §8.2 结果校验：JSON 可解析、text 非空、长度 ≤ max_chars（按字符计）、不含敏感词（不区分大小写）。 */
export function validateBlockOutput(raw: string, maxChars: number, sensitiveWords: readonly string[]): { ok: true; text: string } | { ok: false; problem: BlockProblem; word?: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, problem: "INVALID_JSON" };
  }
  const value = parsed && typeof parsed === "object" ? (parsed as { text?: unknown }).text : undefined;
  if (typeof value !== "string") return { ok: false, problem: "INVALID_JSON" };
  const text = value.trim();
  if (!text) return { ok: false, problem: "EMPTY" };
  if ([...text].length > maxChars) return { ok: false, problem: "TOO_LONG" };
  const lower = text.toLowerCase();
  const word = sensitiveWords.find((item) => item && lower.includes(item.toLowerCase()));
  if (word) return { ok: false, problem: "SENSITIVE_WORD", word };
  return { ok: true, text };
}

export type BlockGenerateInput = {
  campaign: AiCampaign;
  block: AiBlock;
  contact: AiContact;
  rule: AiRuleContext;
  sensitiveWords: readonly string[];
};

export type BlockResult = { ok: true; text: string; attempts: number } | { ok: false; problems: BlockProblem[]; attempts: number };

/** 单个区块：生成一次，校验失败重新生成 1 次；LLM 调用异常（LlmCallError）原样抛出，由调用方决定。 */
export async function generateBlock(llm: LlmClient, input: BlockGenerateInput): Promise<BlockResult> {
  const { campaign, block, contact, rule, sensitiveWords } = input;
  const request = {
    system: blockSystemPrompt(block.max_chars),
    user: blockUserPrompt({
      ai_goal: campaign.ai_goal,
      instruction: block.instruction,
      contact_fields: pickContactFields(contact, campaign.ai_fields),
      matched_tags: rule?.matched_tags ?? [],
      rule_instruction: rule?.instruction ?? ""
    }),
    json: true as const,
    // 中文约 1–2 token / 字，加 JSON 包装余量。
    max_tokens: Math.min(8192, block.max_chars * 3 + 200),
    mock: { kind: "block" as const, block_key: block.key, email: contact.email }
  };
  const problems: BlockProblem[] = [];
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const checked = validateBlockOutput(await llm.complete(request), block.max_chars, sensitiveWords);
    if (checked.ok) return { ok: true, text: checked.text, attempts: attempt };
    problems.push(checked.problem);
  }
  return { ok: false, problems, attempts: 2 };
}

export type ContactBlocksResult =
  | { ok: true; content: Record<string, string>; cached_keys: string[] }
  | { ok: false; block_key: string; problems: BlockProblem[]; content: Record<string, string> };

/**
 * 为一位联系人生成全部区块。
 * - `useCache`：先查 ai_cache（主键 + instruction_hash 一致）命中即原样使用（发送路径）。
 * - `writeCache`：生成成功的区块写入 ai_cache（预览路径）。
 * 任一区块两次校验均失败 → `ok:false`（发送路径据此置 skipped(AI_FAILED)），已成功的区块仍在 content 中。
 */
export async function generateContactBlocks(
  db: Db,
  llm: LlmClient,
  input: Omit<BlockGenerateInput, "block"> & { useCache: boolean; writeCache: boolean }
): Promise<ContactBlocksResult> {
  const { campaign, contact, rule } = input;
  const cache = input.useCache ? await readContactCache(db, campaign.id, contact.id) : new Map<string, { instruction_hash: string; text: string }>();
  const content: Record<string, string> = {};
  const cachedKeys: string[] = [];
  for (const block of campaign.ai_blocks) {
    const hash = blockInstructionHash(campaign, block, rule);
    const hit = cache.get(block.key);
    if (hit && hit.instruction_hash === hash) {
      content[block.key] = hit.text;
      cachedKeys.push(block.key);
      continue;
    }
    const result = await generateBlock(llm, { ...input, block });
    if (!result.ok) return { ok: false, block_key: block.key, problems: result.problems, content };
    content[block.key] = result.text;
    if (input.writeCache) await writeCache(db, { campaign_id: campaign.id, contact_id: contact.id, block_key: block.key, instruction_hash: hash, text: result.text });
  }
  return { ok: true, content, cached_keys: cachedKeys };
}

export async function readContactCache(db: Db, campaignId: string, contactId: string) {
  const rows = await db.select().from(aiCache).where(and(eq(aiCache.campaign_id, campaignId), eq(aiCache.contact_id, contactId)));
  return new Map(rows.map((row) => [row.block_key, { instruction_hash: row.instruction_hash, text: row.text }]));
}

async function writeCache(db: Db, row: { campaign_id: string; contact_id: string; block_key: string; instruction_hash: string; text: string }) {
  await db.insert(aiCache).values(row).onConflictDoUpdate({
    target: [aiCache.campaign_id, aiCache.contact_id, aiCache.block_key],
    set: { instruction_hash: row.instruction_hash, text: row.text, created_at: new Date() }
  });
}
