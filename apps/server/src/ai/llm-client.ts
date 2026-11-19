/**
 * §8.1 LLM 客户端：`complete({ system, user, json: true, max_tokens }) → string`。
 * - 真实实现走 openai SDK（`baseURL=LLM_BASE_URL`、`model=LLM_MODEL`、`response_format: json_object`）；
 *   SDK 自带重试关闭（maxRetries: 0），由这里统一做：429 / 5xx 指数退避，最多重试 3 次。
 * - `LLM_MOCK=1` 返回确定性内容，测试与本地演示不访问网络。
 */
import OpenAI, { APIError } from "openai";
import type { Config } from "../config.ts";

/** mock 模式据此产生确定性输出；真实调用忽略。 */
export type LlmMockHint = { kind: "block"; block_key: string; email: string } | { kind: "reply" };

export type LlmRequest = {
  system: string;
  user: string;
  json: true;
  max_tokens: number;
  mock?: LlmMockHint;
};

export interface LlmClient {
  complete(request: LlmRequest): Promise<string>;
}

/** 重试耗尽或不可重试的 LLM 调用失败（网络、鉴权、4xx 等）。 */
export class LlmCallError extends Error {
  constructor(message: string, readonly status?: number, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LlmCallError";
  }
}

export const LLM_MAX_RETRIES = 3;

export type LlmClientOptions = {
  /** 注入 fetch（测试用假 HTTP 传输）；缺省用全局 fetch。 */
  fetch?: typeof fetch;
  /** 退避等待；测试注入为立即返回。 */
  sleep?: (ms: number) => Promise<void>;
  /** 首次退避毫秒数，第 n 次重试等待 base × 2^(n-1)。 */
  backoffBaseMs?: number;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function isRetryable(error: unknown): boolean {
  if (!(error instanceof APIError)) return false;
  const status = error.status;
  return status === 429 || (typeof status === "number" && status >= 500 && status <= 599);
}

export class OpenAiLlmClient implements LlmClient {
  private readonly client: OpenAI;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly backoffBaseMs: number;

  constructor(private readonly runtime: { baseURL: string; apiKey: string; model: string }, options: LlmClientOptions = {}) {
    this.client = new OpenAI({
      apiKey: runtime.apiKey,
      baseURL: runtime.baseURL,
      maxRetries: 0,
      timeout: 60_000,
      ...(options.fetch ? { fetch: options.fetch } : {})
    });
    this.sleep = options.sleep ?? defaultSleep;
    this.backoffBaseMs = options.backoffBaseMs ?? 1000;
  }

  async complete(request: LlmRequest): Promise<string> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const response = await this.client.chat.completions.create({
          model: this.runtime.model,
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.user }
          ],
          max_tokens: request.max_tokens,
          response_format: { type: "json_object" }
        });
        return response.choices[0]?.message?.content ?? "";
      } catch (error) {
        if (isRetryable(error) && attempt < LLM_MAX_RETRIES) {
          await this.sleep(this.backoffBaseMs * 2 ** attempt);
          continue;
        }
        const status = error instanceof APIError ? error.status : undefined;
        throw new LlmCallError(`LLM 调用失败${status ? `（HTTP ${status}）` : ""}`, status, { cause: error });
      }
    }
  }
}

/** §8.1 mock：区块 → `{"text":"[AI:{block_key}:{email}]"}`；回函分类 → intent `inquiry`。 */
export class MockLlmClient implements LlmClient {
  async complete(request: LlmRequest): Promise<string> {
    const hint = request.mock;
    if (hint?.kind === "block") return JSON.stringify({ text: `[AI:${hint.block_key}:${hint.email}]` });
    if (hint?.kind === "reply") {
      return JSON.stringify({ intent: "inquiry", summary: "客户来信咨询（模拟分类）", suggested_reply: "您好，感谢您的回复。我们已收到您的来信，会尽快确认并答复。" });
    }
    return JSON.stringify({ text: "" });
  }
}

export type LlmRuntime = Pick<Config, "LLM_MOCK" | "LLM_API_KEY" | "LLM_MODEL" | "LLM_BASE_URL">;

/**
 * 按配置创建客户端：`LLM_MOCK=1` → mock（不论是否有 key）；否则 `LLM_API_KEY` 为空 → null（AI 整体关闭）。
 * 注意：send 第一步的 `AI_DISABLED` 按规格只看 `LLM_API_KEY`（§6.2 第 4 步），与这里无关。
 */
export function createLlmClient(runtime: LlmRuntime, options: LlmClientOptions = {}): LlmClient | null {
  if (runtime.LLM_MOCK) return new MockLlmClient();
  if (!runtime.LLM_API_KEY) return null;
  return new OpenAiLlmClient({ baseURL: runtime.LLM_BASE_URL, apiKey: runtime.LLM_API_KEY, model: runtime.LLM_MODEL ?? "" }, options);
}
