/**
 * §8.4 回函分类：只对 category='human' 的来信执行（调用方 inbound/process.ts 保证）。
 * 输入为主题与去引用、截断至 4000 字的正文；输出 `{ intent, summary(≤100), suggested_reply(≤200) }`。
 * LLM 未启用时不创建分类器（intent=null、needs_review=true，见 inbound/reply-classifier.ts）。
 */
import { ReplyIntentSchema } from "@mailqivo/shared";
import type { InboundClassifier, ReplyClassification } from "../inbound/reply-classifier.ts";
import { LlmCallError, type LlmClient } from "./llm-client.ts";
import { REPLY_SYSTEM_PROMPT, replyUserPrompt } from "./prompts.ts";

const MAX_INPUT = 4000;

/** 解析模型输出；intent 不在枚举内或 JSON 无效 → intent=null（进入人工复核）。 */
export function parseReplyClassification(raw: string): ReplyClassification {
  let parsed: Record<string, unknown> = {};
  try {
    const value: unknown = JSON.parse(raw);
    if (value && typeof value === "object") parsed = value as Record<string, unknown>;
  } catch {
    return { intent: null, summary: "", suggested_reply: "" };
  }
  const intent = ReplyIntentSchema.safeParse(parsed.intent);
  const text = (value: unknown, max: number) => (typeof value === "string" ? [...value.trim()].slice(0, max).join("") : "");
  return {
    intent: intent.success ? intent.data : null,
    summary: text(parsed.summary, 100),
    suggested_reply: text(parsed.suggested_reply, 200)
  };
}

export async function classifyReply(llm: LlmClient, input: { subject: string; text: string }): Promise<ReplyClassification> {
  const raw = await llm.complete({
    system: REPLY_SYSTEM_PROMPT,
    user: replyUserPrompt({ subject: input.subject, text: input.text.slice(0, MAX_INPUT) }),
    json: true,
    max_tokens: 800,
    mock: { kind: "reply" }
  });
  return parseReplyClassification(raw);
}

export function createLlmReplyClassifier(llm: LlmClient): InboundClassifier {
  return {
    async classifyReply(input) {
      try {
        return await classifyReply(llm, input);
      } catch (error) {
        // 重试耗尽等调用失败：不阻断来信落库，交给人工复核。
        if (error instanceof LlmCallError) return { intent: null, summary: "", suggested_reply: "" };
        throw error;
      }
    }
  };
}
