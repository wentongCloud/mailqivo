"use client";

import { useTranslations } from "next-intl";
import { ApiError } from "@/lib/api/client";

/** 服务端 content-rules.ts 的 VALIDATION details.rules 项（只读取展示所需字段）。 */
type RuleProblem = {
  index: number;
  name: string;
  problem: string;
  tags?: string[];
  assets?: { asset_id: string; filename: string | null; problem: string }[];
};

const KNOWN = new Set([
  "TAG_NOT_FOUND",
  "ASSET_UNUSABLE",
  "INSTRUCTION_WITHOUT_AI_BLOCKS",
  "TOO_MANY_ATTACHMENTS",
  "DUPLICATE_TAG_SET",
  "DUPLICATE_PRIORITY",
  "MULTIPLE_FALLBACK",
  "ATTACHMENTS_TOO_LARGE"
]);
const ASSET_REASONS = new Set(["NOT_FOUND", "DISABLED", "FILE_MISSING", "FILE_UNREADABLE", "SHA_MISMATCH"]);

export function ruleProblemsOf(error: unknown): RuleProblem[] {
  if (!(error instanceof ApiError) || error.body.code !== "VALIDATION") return [];
  const rules = (error.body.details as { rules?: RuleProblem[] } | undefined)?.rules;
  return Array.isArray(rules) ? rules : [];
}

/** 设计 §1.2：规则引用失效时指出对应的规则及标签或附件。草稿保存与发送摘要两个失败出口共用。 */
export function RuleProblems({ problems }: { problems: RuleProblem[] }) {
  const t = useTranslations("ContentRuleProblems");
  if (!problems.length) return null;
  return (
    <ul className="text-destructive list-disc space-y-1 pl-5 text-sm">
      {problems.map((item, position) => (
        <li key={`${item.index}-${item.problem}-${position}`}>
          {t("rule", { name: item.name || String(item.index + 1) })}
          {KNOWN.has(item.problem)
            ? t(item.problem, { tags: (item.tags ?? []).join(", "), count: item.assets?.length ?? 0 })
            : t("OTHER", { code: item.problem })}
          {!!item.assets?.length && (
            <ul className="list-[circle] pl-5">
              {item.assets.map((asset) => (
                <li key={asset.asset_id}>
                  {asset.filename ?? asset.asset_id}
                  {"："}
                  {ASSET_REASONS.has(asset.problem) ? t(`asset.${asset.problem}`) : asset.problem}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}
