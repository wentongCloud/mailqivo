/**
 * §5.4 写操作两步确认（通用，供 contact_status / campaign_send / campaign_cancel / import_commit / message_requeue_unknown 复用）。
 *
 * 用法（路由内）：
 *
 *   const summary = await computeSummary(...);            // 每次调用都重新计算
 *   const target = { ...操作对象与参数 };
 *   if (!body.confirm_token) return issueConfirmToken(db, { action, target, summary });
 *   await consumeConfirmToken(db, { token: body.confirm_token, action, target, summary });
 *   ...执行写操作...
 *
 * 令牌有效期 10 分钟、只能用一次。校验失败一律抛 CONFIRM_INVALID（409），`details.reason` 说明原因：
 * 摘要或目标变化时，details 里附带 `summary` 与新的 `confirm_token`（旧令牌同时作废）。
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { ConfirmAction, ConfirmChallenge } from "@mailqivo/shared";
import type { Db } from "../db/client.ts";
import { confirmTokens } from "../db/schema.ts";
import { AppError } from "./errors.ts";

export const CONFIRM_TOKEN_TTL_MS = 10 * 60 * 1000;

export type ConfirmTokenReason = "NOT_FOUND" | "USED" | "EXPIRED" | "TARGET_MISMATCH" | "SUMMARY_CHANGED";

type Params<S> = {
  action: ConfirmAction;
  /** 操作对象及参数（会存库，第二步必须一致） */
  target: unknown;
  /** 本次计算出的摘要 */
  summary: S;
  /** 测试用：覆盖“当前时间” */
  now?: Date;
};

/** 键排序后的稳定 JSON，使摘要哈希与对象键顺序无关。 */
export function stableStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

export function summaryHash(summary: unknown): string {
  return createHash("sha256").update(stableStringify(summary)).digest("hex");
}

/** 第一步：发放令牌，不做任何写操作（除了写入令牌本身）。 */
export async function issueConfirmToken<S>(db: Db, params: Params<S>): Promise<ConfirmChallenge<S>> {
  const now = params.now ?? new Date();
  const token = randomBytes(24).toString("base64url");
  await db.insert(confirmTokens).values({
    token,
    action: params.action,
    target: JSON.parse(stableStringify(params.target)),
    summary_hash: summaryHash(params.summary),
    expires_at: new Date(now.getTime() + CONFIRM_TOKEN_TTL_MS)
  });
  return { requires_confirmation: true, confirm_token: token, summary: params.summary };
}

/** 第二步：校验并作废令牌。通过则正常返回，之后调用方才能执行写操作。 */
export async function consumeConfirmToken<S>(
  db: Db,
  params: Params<S> & { token: string }
): Promise<void> {
  const now = params.now ?? new Date();
  const fail = (reason: ConfirmTokenReason, message: string, extra?: Record<string, unknown>) =>
    new AppError("CONFIRM_INVALID", message, { reason, ...extra });

  const [row] = await db.select().from(confirmTokens).where(eq(confirmTokens.token, params.token));
  if (!row || row.action !== params.action) throw fail("NOT_FOUND", "确认令牌无效");
  if (row.used_at) throw fail("USED", "确认令牌已被使用，请重新发起操作");
  if (row.expires_at.getTime() <= now.getTime()) throw fail("EXPIRED", "确认令牌已过期，请重新发起操作");

  // 原子地占用令牌：并发的两次请求只有一次能成功
  const claimed = await db
    .update(confirmTokens)
    .set({ used_at: now })
    .where(and(eq(confirmTokens.token, params.token), isNull(confirmTokens.used_at)))
    .returning({ token: confirmTokens.token });
  if (claimed.length === 0) throw fail("USED", "确认令牌已被使用，请重新发起操作");

  const targetMatches = stableStringify(row.target) === stableStringify(params.target);
  const summaryMatches = row.summary_hash === summaryHash(params.summary);
  if (!targetMatches || !summaryMatches) {
    const next = await issueConfirmToken(db, params);
    throw fail(
      targetMatches ? "SUMMARY_CHANGED" : "TARGET_MISMATCH",
      targetMatches ? "数据已发生变化，请重新确认最新摘要" : "操作内容与确认时不一致，请重新确认",
      { summary: next.summary, confirm_token: next.confirm_token }
    );
  }
}
