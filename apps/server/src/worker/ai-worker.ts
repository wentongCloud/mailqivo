/**
 * §6.3 AI worker：处理活动状态为 `sending` / `paused` 的 `pending_ai` message，并发数 `LLM_CONCURRENCY`，逻辑见 §8.2。
 * - 规则只读 `messages.content_rule_snapshot`（preparing 时写入），**不重新匹配**联系人当前 Tags；
 * - 先查 ai_cache（主键 + instruction_hash 一致）命中即原样使用，保证预览确认过的样例原样发出；
 * - 成功：写 `ai_content`，转 `queued`；两次校验均失败：`skipped(AI_FAILED)`。
 * pending_ai 没有中间状态，用 `locked_at` 作租约防止重复领取（10 分钟过期，进程崩溃后可再领取）。
 */
import { and, eq, sql } from "drizzle-orm";
import { AiBlock, type ContentRuleSnapshot } from "@mailqivo/shared";
import { generateContactBlocks, type AiRuleContext } from "../ai/generate-blocks.ts";
import { createLlmClient, LlmCallError, type LlmClient, type LlmRuntime } from "../ai/llm-client.ts";
import type { Config } from "../config.ts";
import type { Db } from "../db/client.ts";
import { contacts, messages } from "../db/schema.ts";
import { getCampaignRow, markCampaignCompletedIfDone } from "../modules/campaigns/service.ts";
import { getSettings } from "../modules/settings/service.ts";
import type { MessageRow } from "./send-worker.ts";
import { startClaimLoop } from "./claim-loop.ts";

export type AiWorkerRuntime = LlmRuntime & Pick<Config, "LLM_CONCURRENCY">;

export type AiWorkerOptions = {
  concurrency?: number;
  /** 注入 LLM 客户端；缺省按配置创建（mock / 真实 / null）。 */
  llm?: LlmClient | null;
  /** LLM 调用失败（重试耗尽）后多久再试，默认 5 分钟。 */
  retryDelayMs?: number;
};

const LEASE = sql`interval '10 minutes'`;

export async function claimPendingAiMessages(db: Db, limit: number): Promise<MessageRow[]> {
  if (limit <= 0) return [];
  const result = await db.execute<MessageRow>(sql`
    UPDATE messages SET locked_at = now()
    WHERE id IN (
      SELECT m.id FROM messages m JOIN campaigns c ON c.id = m.campaign_id
      WHERE m.status = 'pending_ai' AND m.next_attempt_at <= now()
        AND (m.locked_at IS NULL OR m.locked_at < now() - ${LEASE})
        AND c.status IN ('sending', 'paused')
      ORDER BY m.next_attempt_at LIMIT ${limit} FOR UPDATE OF m SKIP LOCKED
    )
    RETURNING *
  `);
  return result.rows;
}

/** 只改仍为 pending_ai 的行（期间被取消的活动已把它置为 skipped，不得覆盖）。 */
async function finish(db: Db, message: MessageRow, values: Partial<typeof messages.$inferInsert>) {
  await db.update(messages).set({ ...values, locked_at: null }).where(and(eq(messages.id, message.id), eq(messages.status, "pending_ai")));
}

export async function processPendingAiMessage(db: Db, llm: LlmClient, message: MessageRow, options: AiWorkerOptions = {}): Promise<"queued" | "skipped" | "retry"> {
  const campaign = await getCampaignRow(db, message.campaign_id);
  const [contact] = message.contact_id ? await db.select().from(contacts).where(eq(contacts.id, message.contact_id)) : [];
  if (!contact) {
    // 联系人已删除：没有可用字段，交给 send worker 按 §6.3 步骤 2 置 skipped，不调用 LLM。
    await finish(db, message, { status: "queued", next_attempt_at: new Date() });
    return "queued";
  }
  const snapshot = message.content_rule_snapshot as ContentRuleSnapshot | null;
  const rule: AiRuleContext = snapshot ? { id: snapshot.id, instruction: snapshot.instruction, matched_tags: snapshot.matched_tags } : null;
  const settings = await getSettings(db);
  try {
    const result = await generateContactBlocks(db, llm, {
      campaign: { id: campaign.id, ai_goal: campaign.ai_goal, ai_fields: campaign.ai_fields, ai_blocks: AiBlock.array().parse(campaign.ai_blocks) },
      contact: { id: contact.id, email: contact.email, name: contact.name, company: contact.company, title: contact.title, custom_fields: contact.custom_fields as Record<string, unknown> },
      rule,
      sensitiveWords: settings.sensitive_words,
      useCache: true,
      writeCache: false
    });
    if (result.ok) {
      await finish(db, message, { status: "queued", ai_content: result.content, next_attempt_at: new Date() });
      return "queued";
    }
    await finish(db, message, { status: "skipped", skip_reason: "AI_FAILED", smtp_response: `AI 区块 ${result.block_key} 两次生成均未通过校验：${result.problems.join("、")}` });
    await markCampaignCompletedIfDone(db, campaign.id);
    return "skipped";
  } catch (error) {
    if (!(error instanceof LlmCallError)) throw error;
    // SPEC-GAP: §8.2 只规定“校验失败 → 重新生成 1 次 → AI_FAILED”；LLM 调用本身失败（客户端 3 次重试后）不算校验失败，
    // 保持 pending_ai、释放租约并延后重试，不消耗样例、不跳过收件人（宁可晚发、不可错发）。
    console.error(`[ai-worker] message ${message.id} LLM 调用失败，稍后重试：${error.message}`);
    await finish(db, message, { next_attempt_at: new Date(Date.now() + (options.retryDelayMs ?? 5 * 60_000)) });
    return "retry";
  }
}

export async function runAiWorkerOnce(db: Db, runtime: AiWorkerRuntime, options: AiWorkerOptions = {}): Promise<number> {
  const llm = options.llm !== undefined ? options.llm : createLlmClient(runtime);
  // SPEC-GAP: AI 关闭时（无 key、非 mock）不处理 pending_ai，也不置为 AI_FAILED；配置 key 后自动继续。
  if (!llm) return 0;
  const claimed = await claimPendingAiMessages(db, options.concurrency ?? runtime.LLM_CONCURRENCY);
  await Promise.all(claimed.map(async (message) => {
    try {
      await processPendingAiMessage(db, llm, message, options);
    } catch (error) {
      // 单条异常不影响其他 message；租约到期后可再次领取。
      console.error(`[ai-worker] message ${message.id} 处理失败`, error);
    }
  }));
  return claimed.length;
}

export function startAiWorker(db: Db, runtime: AiWorkerRuntime, options: AiWorkerOptions = {}) {
  const llm = options.llm !== undefined ? options.llm : createLlmClient(runtime);
  const shared = { ...options, llm };
  return startClaimLoop<MessageRow>({
    name: "ai-worker",
    concurrency: options.concurrency ?? runtime.LLM_CONCURRENCY,
    // SPEC-GAP: AI 关闭时不领取 pending_ai。
    claim: (limit) => llm ? claimPendingAiMessages(db, limit) : Promise.resolve([]),
    process: async (message) => { await processPendingAiMessage(db, llm!, message, shared); }
  });
}
