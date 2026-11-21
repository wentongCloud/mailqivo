import { sql } from "drizzle-orm";
import type { TemplateIssue } from "@mailqivo/shared";
import type { Db } from "../../db/client.ts";
import { aiBlockKey, BUILTIN_TEMPLATE_KEYS, TEMPLATE_VARIABLE_PATTERN, templateVariables } from "../../render/template.ts";

const FRAGMENT_MAX_CHARS = 40;

/** 片段只取同一行内的文字。 */
function fragmentAt(source: string, start: number, end: number): string {
  const text = source.slice(start, end);
  const lines = text.split(/\r?\n/);
  return (end <= start + 2 || !text.startsWith("{{") ? lines[lines.length - 1] : lines[0])!;
}

/**
 * `{{` 或 `}}` 不属于任何合法变量时报告片段。未闭合或含非法字符的 `{{…}}` 作为一个片段报告，
 * 其中的 `}}` 不再单独报告。
 */
function syntaxIssues(source: string): TemplateIssue[] {
  const covered: [number, number][] = [];
  for (const match of source.matchAll(TEMPLATE_VARIABLE_PATTERN)) covered.push([match.index, match.index + match[0].length]);
  const inside = (index: number) => covered.some(([start, end]) => index >= start && index < end);
  const issues: TemplateIssue[] = [];
  for (let index = source.indexOf("{{"); index >= 0; index = source.indexOf("{{", index + 2)) {
    if (inside(index)) continue;
    // 解析范围：到最近的 `}}` 为止；其前若出现下一个 `{{`，则到该 `{{` 之前；都没有则到正文末尾。
    // FRAGMENT_MAX_CHARS 只限制显示片段，不限制解析范围，以免遮住后面的 `{{`。
    const close = source.indexOf("}}", index + 2);
    const next = source.indexOf("{{", index + 2);
    const end = close >= 0 && (next < 0 || close < next) ? close + 2 : next >= 0 ? next : source.length;
    issues.push({ kind: "syntax", fragment: fragmentAt(source, index, Math.min(end, index + FRAGMENT_MAX_CHARS)) });
    covered.push([index, end]);
  }
  for (let index = source.indexOf("}}"); index >= 0; index = source.indexOf("}}", index + 2)) {
    if (inside(index)) continue;
    // 片段从前一个变量或片段之后开始，至多 FRAGMENT_MAX_CHARS 个字符。
    const previous = Math.max(0, ...covered.map(([, end]) => end).filter((end) => end <= index));
    issues.push({ kind: "syntax", fragment: fragmentAt(source, Math.max(previous, index + 2 - FRAGMENT_MAX_CHARS), index + 2) });
  }
  return issues;
}

/**
 * 规格 §7.2「模板导入诊断」唯一实现：异常语法与无默认值的未知变量。
 * 只供模板导入入口调用；活动创建、发送摘要与提交不调用（规格 §6.2 第 3 条）。
 */
export async function diagnoseTemplate(db: Db, source: string, aiBlockKeys: readonly string[]): Promise<TemplateIssue[]> {
  const customKeys = await db.execute<{ key: string }>(sql`SELECT DISTINCT jsonb_object_keys(custom_fields) AS key FROM contacts`);
  const custom = new Set(customKeys.rows.map((item) => item.key));
  const blocks = new Set(aiBlockKeys);
  const unknown = templateVariables(source)
    .filter((item) => !item.hasDefault)
    .filter((item) => {
      if (BUILTIN_TEMPLATE_KEYS.has(item.key) || custom.has(item.key)) return false;
      const blockKey = aiBlockKey(item.key);
      return blockKey === undefined || !blocks.has(blockKey);
    })
    .map((item): TemplateIssue => ({ kind: "unknown_variable", key: item.key }));
  return [...syntaxIssues(source), ...unknown];
}
