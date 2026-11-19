/**
 * §8.2 内容规则（V1.1）唯一实现：id 处理、保存校验、匹配、send 第一步的标签 / 附件校验与 breakdown、
 * preparing 快照的组装。R4（AI 预览、缓存键、按规则样例门禁）与 R5（MCP）只调用这里导出的函数。
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray, type SQL } from "drizzle-orm";
import {
  canonicalIndustry,
  CONTENT_RULE_LIMITS,
  type AssetDto,
  type AttachmentSnapshotItem,
  type ContentRule,
  type ContentRuleBreakdownItem,
  type ContentRuleInput,
  type ContentRuleSnapshot
} from "@mailqivo/shared";
import type { z } from "zod";
import type { Config } from "../../config.ts";
import type { Db } from "../../db/client.ts";
import { assets, contacts, contactTags, tags } from "../../db/schema.ts";
import { AppError } from "../../lib/errors.ts";
import { assertAssetsUsable, encodedSize } from "../assets/index.ts";
import { getAttachmentMaxTotalMb } from "../settings/service.ts";

export type { ContentRule, ContentRuleInput, ContentRuleSnapshot };
export type ParsedContentRule = z.output<typeof ContentRuleInput>;
type StorageConfig = Pick<Config, "ASSET_DIR">;

/** 校验问题：details.rules 的单项。`index` 为请求 / 存储数组中的下标。 */
export type ContentRuleProblem = {
  index: number;
  rule_id: string | null;
  name: string;
  field: "id" | "name" | "tags_all" | "instruction" | "attachment_ids" | "priority" | "enabled";
  problem:
    | "TAG_NOT_FOUND"
    | "DUPLICATE_TAG_SET"
    | "DUPLICATE_PRIORITY"
    | "MULTIPLE_FALLBACK"
    | "INSTRUCTION_WITHOUT_AI_BLOCKS"
    | "ASSET_UNUSABLE"
    | "TOO_MANY_ATTACHMENTS"
    | "ATTACHMENTS_TOO_LARGE";
  tags?: string[];
  assets?: { asset_id: string; problem: string }[];
  other_index?: number;
  encoded_bytes?: number;
  limit_bytes?: number;
};

const dedupe = <T>(items: readonly T[]) => [...new Set(items)];
const conditionKey = (rule: { tags_all: readonly string[]; industry?: string }) =>
  JSON.stringify([canonicalIndustry(rule.industry ?? ""), ...dedupe(rule.tags_all).sort()]);

/** 联系人自定义字段 industry。缺省或非字符串视为不限。 */
export function contactIndustry(customFields: unknown): string {
  if (!customFields || typeof customFields !== "object") return "";
  const value = (customFields as Record<string, unknown>).industry;
  return typeof value === "string" ? value.trim() : "";
}

/** 读取 campaigns.content_rules（jsonb）为规则数组；旧行缺省为空。 */
export function parseStoredRules(value: unknown): ContentRule[] {
  if (!Array.isArray(value)) return [];
  return value as ContentRule[];
}

// ---------------------------------------------------------------------------
// 保存：id 处理 + §8.2 保存校验
// ---------------------------------------------------------------------------

/**
 * 保存规则（活动 create / PATCH，草稿态）：带已有 id 的保留，不带的新生成，缺席即删除。
 * 任一校验失败 → VALIDATION，details.rules 一次列出全部问题。
 */
export async function normalizeContentRules(
  db: Db,
  config: StorageConfig,
  input: ParsedContentRule[],
  existing: ContentRule[],
  hasAiBlocks: boolean
): Promise<ContentRule[]> {
  const existingIds = new Set(existing.map((rule) => rule.id));
  const used = new Set<string>();
  const rules: ContentRule[] = input.map((rule) => {
    // SPEC-GAP: 请求中带的 id 不属于本活动（例如从其他活动复制）或在本次请求中重复时，按“新增”处理并生成新 id，不报错。
    const keep = rule.id && existingIds.has(rule.id) && !used.has(rule.id);
    const id = keep ? rule.id! : randomUUID();
    used.add(id);
    return {
      id,
      name: rule.name,
      // SPEC-GAP: 同一规则内重复的标签名 / 资产 id 按首次出现去重（集合语义），不报错。
      tags_all: dedupe(rule.tags_all),
      industry: canonicalIndustry(rule.industry ?? ""),
      instruction: rule.instruction,
      attachment_ids: dedupe(rule.attachment_ids),
      priority: rule.priority,
      enabled: rule.enabled
    };
  });
  const problems = [...structuralProblems(rules, hasAiBlocks), ...(await missingTagProblems(db, rules))];
  problems.push(...(await unusableAssetProblems(db, config, rules)));
  if (problems.length) throw ruleValidationError("内容规则校验失败", problems);
  return rules;
}

function ruleValidationError(message: string, problems: ContentRuleProblem[]) {
  return new AppError("VALIDATION", message, { rules: problems.sort((a, b) => a.index - b.index) });
}

const ref = (rule: ContentRule, index: number) => ({ index, rule_id: rule.id, name: rule.name });

/** 纯函数：启用规则之间集合 / priority 唯一、回退至多一条；有指令而无 ai_blocks。 */
export function structuralProblems(rules: ContentRule[], hasAiBlocks: boolean): ContentRuleProblem[] {
  const problems: ContentRuleProblem[] = [];
  const bySet = new Map<string, number>();
  const byPriority = new Map<number, number>();
  let fallback: number | null = null;
  rules.forEach((rule, index) => {
    if (rule.instruction.trim() && !hasAiBlocks) {
      problems.push({ ...ref(rule, index), field: "instruction", problem: "INSTRUCTION_WITHOUT_AI_BLOCKS" });
    }
    if (rule.attachment_ids.length > CONTENT_RULE_LIMITS.attachments) {
      problems.push({ ...ref(rule, index), field: "attachment_ids", problem: "TOO_MANY_ATTACHMENTS" });
    }
    if (!rule.enabled) return;
    const key = conditionKey(rule);
    if (bySet.has(key)) problems.push({ ...ref(rule, index), field: "tags_all", problem: "DUPLICATE_TAG_SET", other_index: bySet.get(key)! });
    else bySet.set(key, index);
    if (byPriority.has(rule.priority)) problems.push({ ...ref(rule, index), field: "priority", problem: "DUPLICATE_PRIORITY", other_index: byPriority.get(rule.priority)! });
    else byPriority.set(rule.priority, index);
    if (rule.tags_all.length === 0 && !rule.industry?.trim()) {
      if (fallback !== null) problems.push({ ...ref(rule, index), field: "tags_all", problem: "MULTIPLE_FALLBACK", other_index: fallback });
      else fallback = index;
    }
  });
  return problems;
}

/** 规则引用的标签名必须存在于 tags 表（精确、区分大小写）。`only` 限定检查哪些规则。 */
export async function missingTagProblems(db: Db, rules: ContentRule[], only: (rule: ContentRule) => boolean = () => true): Promise<ContentRuleProblem[]> {
  const names = dedupe(rules.filter(only).flatMap((rule) => rule.tags_all));
  if (!names.length) return [];
  const rows = await db.select({ name: tags.name }).from(tags).where(inArray(tags.name, names));
  const existing = new Set(rows.map((row) => row.name));
  const problems: ContentRuleProblem[] = [];
  rules.forEach((rule, index) => {
    if (!only(rule)) return;
    const missing = rule.tags_all.filter((name) => !existing.has(name));
    if (missing.length) problems.push({ ...ref(rule, index), field: "tags_all", problem: "TAG_NOT_FOUND", tags: missing });
  });
  return problems;
}

/**
 * 新引用检查：经 `assertAssetsUsable`（存在、enabled、文件可读、sha256 一致）。
 * 返回问题列表与可用资产（按 id）；每个资产只读一次文件。
 */
async function checkAssets(db: Db, config: StorageConfig, rules: ContentRule[], only: (rule: ContentRule) => boolean) {
  const ids = dedupe(rules.filter(only).flatMap((rule) => rule.attachment_ids));
  const byId = new Map<string, AssetDto>();
  const bad = new Map<string, string>();
  if (ids.length) {
    try {
      for (const asset of await assertAssetsUsable(db, config, ids)) byId.set(asset.id, asset);
    } catch (error) {
      const details = error instanceof AppError && error.code === "VALIDATION" ? (error.details as { assets?: { asset_id: string; problem: string }[] } | undefined) : undefined;
      if (!details?.assets) throw error;
      for (const item of details.assets) bad.set(item.asset_id, item.problem);
      // 其余资产仍然可用：对它们再取一次元数据（问题资产已排除）。
      const okIds = ids.filter((id) => !bad.has(id));
      if (okIds.length) for (const asset of await assertAssetsUsable(db, config, okIds)) byId.set(asset.id, asset);
    }
  }
  const problems: ContentRuleProblem[] = [];
  rules.forEach((rule, index) => {
    if (!only(rule)) return;
    const unusable = rule.attachment_ids.filter((id) => bad.has(id)).map((id) => ({ asset_id: id, problem: bad.get(id)! }));
    if (unusable.length) problems.push({ ...ref(rule, index), field: "attachment_ids", problem: "ASSET_UNUSABLE", assets: unusable });
  });
  return { problems, byId };
}

async function unusableAssetProblems(db: Db, config: StorageConfig, rules: ContentRule[]) {
  return (await checkAssets(db, config, rules, () => true)).problems;
}

// ---------------------------------------------------------------------------
// 匹配（纯函数）
// ---------------------------------------------------------------------------

export type ContentRuleMatch = { rule: ContentRule; matched_tags: string[] };

/**
 * §8.2 匹配：`enabled` 且 `tags_all ⊆ 联系人 Tags`（精确、区分大小写）。
 * `industry` 为空表示不限行业；有值时还须与联系人行业一致。
 * 多条命中取条件更具体者（标签数，指定行业再 +1），再取 `priority` 小者。`matched_tags = tags_all`。
 */
export function matchContentRule(
  rules: readonly ContentRule[],
  contactTagNames: Iterable<string>,
  industry?: string | null
): ContentRuleMatch | null {
  const owned = new Set(contactTagNames);
  const contactIndustry = canonicalIndustry(industry ?? "");
  let best: ContentRule | null = null;
  let bestScore = -1;
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const ruleIndustry = canonicalIndustry(rule.industry ?? "");
    if (ruleIndustry && ruleIndustry !== contactIndustry) continue;
    if (!rule.tags_all.every((name) => owned.has(name))) continue;
    const score = rule.tags_all.length + (ruleIndustry ? 1 : 0);
    if (!best || score > bestScore || (score === bestScore && rule.priority < best.priority)) {
      best = rule;
      bestScore = score;
    }
  }
  return best ? { rule: best, matched_tags: [...best.tags_all] } : null;
}

export function toRuleSnapshot(match: ContentRuleMatch): ContentRuleSnapshot {
  const { rule, matched_tags } = match;
  return { id: rule.id, name: rule.name, tags_all: [...rule.tags_all], instruction: rule.instruction, matched_tags };
}

/** 联系人 id → 标签名（只含 where 选中的联系人；where 以未起别名的 contacts 为主表条件）。 */
export async function contactTagNames(db: Db, where: SQL | undefined): Promise<Map<string, string[]>> {
  const rows = await db
    .select({ contact_id: contactTags.contact_id, name: tags.name })
    .from(contactTags)
    .innerJoin(tags, eq(tags.id, contactTags.tag_id))
    .innerJoin(contacts, eq(contacts.id, contactTags.contact_id))
    .where(where ? and(where) : undefined);
  const map = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.contact_id) continue;
    const list = map.get(row.contact_id) ?? [];
    list.push(row.name);
    map.set(row.contact_id, list);
  }
  return map;
}

// ---------------------------------------------------------------------------
// send 第一步（§6.2 第 6 步）与试发
// ---------------------------------------------------------------------------

/**
 * 校验启用规则（或 `only` 指定的规则）的附件：资产可用（assertAssetsUsable）、每条 ≤10、
 * 编码后总大小 ≤ attachment_max_total_mb。失败 → VALIDATION（details.rules 列出规则与资产）。
 * 成功返回 rule.id → 去重有序的 AssetDto[]。
 */
export async function assertRuleAttachments(
  db: Db,
  config: StorageConfig,
  rules: ContentRule[],
  only: (rule: ContentRule) => boolean = (rule) => rule.enabled
): Promise<Map<string, AssetDto[]>> {
  const { problems, byId } = await checkAssets(db, config, rules, only);
  const limitBytes = (await getAttachmentMaxTotalMb(db)) * 1024 * 1024;
  const result = new Map<string, AssetDto[]>();
  rules.forEach((rule, index) => {
    if (!only(rule)) return;
    const ids = dedupe(rule.attachment_ids);
    if (ids.length > CONTENT_RULE_LIMITS.attachments) {
      problems.push({ ...ref(rule, index), field: "attachment_ids", problem: "TOO_MANY_ATTACHMENTS" });
    }
    const list = ids.map((id) => byId.get(id)).filter((asset): asset is AssetDto => !!asset);
    const encoded = list.reduce((sum, asset) => sum + encodedSize(asset.size_bytes), 0);
    if (encoded > limitBytes) {
      problems.push({ ...ref(rule, index), field: "attachment_ids", problem: "ATTACHMENTS_TOO_LARGE", encoded_bytes: encoded, limit_bytes: limitBytes });
    }
    result.set(rule.id, list);
  });
  if (problems.length) throw ruleValidationError("内容规则的附件不可用", problems);
  return result;
}

/** send 第一步：启用规则引用的标签必须仍存在。 */
export async function assertRuleTagsExist(db: Db, rules: ContentRule[]): Promise<void> {
  // SPEC-GAP: §6.2 第 6 步「规则引用的标签若已不存在」未限定启用规则；停用规则不参与匹配，这里只检查启用规则。
  const problems = await missingTagProblems(db, rules, (rule) => rule.enabled);
  if (problems.length) throw ruleValidationError("内容规则引用的标签已不存在", problems);
}

/** §6.2 breakdown：按规则顺序列出每条启用规则的命中人数与附件，另计未命中人数。 */
export function computeRulesBreakdown(
  rules: ContentRule[],
  recipients: { id: string }[],
  tagsByContact: Map<string, string[]>,
  attachmentsByRule: Map<string, AssetDto[]>,
  industryByContact: Map<string, string> = new Map()
): { content_rules_breakdown: Omit<ContentRuleBreakdownItem, "has_sample">[]; unmatched_recipients: number } {
  const counts = new Map<string, number>();
  let unmatched = 0;
  for (const contact of recipients) {
    const match = matchContentRule(rules, tagsByContact.get(contact.id) ?? [], industryByContact.get(contact.id));
    if (match) counts.set(match.rule.id, (counts.get(match.rule.id) ?? 0) + 1);
    else unmatched += 1;
  }
  return {
    content_rules_breakdown: rules.filter((rule) => rule.enabled).map((rule) => ({
      rule_id: rule.id,
      name: rule.name,
      recipients: counts.get(rule.id) ?? 0,
      attachments: (attachmentsByRule.get(rule.id) ?? []).map((asset) => ({ asset_id: asset.id, filename: asset.filename, size_bytes: asset.size_bytes }))
    })),
    unmatched_recipients: unmatched
  };
}

// ---------------------------------------------------------------------------
// preparing 快照
// ---------------------------------------------------------------------------

/** 读取规则引用的资产元数据（不检查 enabled、不读文件）。 */
export async function assetMetaById(db: Db, rules: ContentRule[]) {
  const ids = dedupe(rules.filter((rule) => rule.enabled).flatMap((rule) => rule.attachment_ids));
  const rows = ids.length ? await db.select().from(assets).where(inArray(assets.id, ids)) : [];
  return new Map(rows.map((row) => [row.id, row]));
}

/** 命中规则的附件快照：按 attachment_ids 顺序、去重；无附件 → null。 */
export function buildAttachmentSnapshot(
  rule: ContentRule,
  meta: Map<string, { id: string; filename: string; mime_type: string; size_bytes: number; sha256: string }>
): AttachmentSnapshotItem[] | null {
  const items = dedupe(rule.attachment_ids).map((id): AttachmentSnapshotItem => {
    const row = meta.get(id);
    // SPEC-GAP: 资产记录不存在（V1.1 无删除接口，理论上不可达）时仍写入该项，worker 读取时得到 RECORD_MISSING → skipped(ATTACHMENT_UNAVAILABLE)，绝不去掉附件发送。
    return row
      ? { asset_id: row.id, filename: row.filename, mime_type: row.mime_type, size_bytes: row.size_bytes, sha256: row.sha256 }
      : { asset_id: id, filename: "", mime_type: "application/octet-stream", size_bytes: 0, sha256: "" };
  });
  return items.length ? items : null;
}
