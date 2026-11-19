import type { ReasonCode, ReplyIntent } from "@mailqivo/shared";
import { createLlmReplyClassifier } from "../ai/classify-reply.ts";
import { createLlmClient, type LlmRuntime } from "../ai/llm-client.ts";

export type ReplyClassification = {
  /** null：模型输出无效或调用失败，来信进入人工复核（needs_review=true）。 */
  intent: ReplyIntent | null;
  summary: string;
  suggested_reply: string;
};

export type InboundClassifier = {
  classifyReply(input: { subject: string; text: string }): Promise<ReplyClassification>;
  classifyBounce?(input: { status: string | null; diagnostic: string | null; text: string }): Promise<ReasonCode>;
};

/**
 * §8.4：`LLM_MOCK=1` → mock 客户端（intent 固定 inquiry）；`LLM_API_KEY` 为空 → null
 * （intent=null、needs_review=true）；否则为真实 LLM 分类器（`ai/classify-reply.ts`）。
 */
export function createInboundClassifier(runtime: Partial<LlmRuntime> & Pick<LlmRuntime, "LLM_MOCK" | "LLM_API_KEY">): InboundClassifier | null {
  const llm = createLlmClient({
    LLM_MOCK: runtime.LLM_MOCK,
    LLM_API_KEY: runtime.LLM_API_KEY,
    LLM_MODEL: runtime.LLM_MODEL,
    LLM_BASE_URL: runtime.LLM_BASE_URL ?? "https://api.moonshot.cn/v1"
  });
  return llm ? createLlmReplyClassifier(llm) : null;
}

export function removeQuotedText(text: string): string {
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];
  for (const line of lines) {
    if (/^>/.test(line) || /^On .+ wrote:$/i.test(line) || /^在 .+写道[：:]/.test(line) || /^-{2,}\s*Original Message\s*-{2,}/i.test(line)) break;
    kept.push(line);
  }
  return kept.join("\n").trim().slice(0, 4000);
}
