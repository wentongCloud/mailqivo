/**
 * 改写当前邮件 HTML。保留 {{变量}}。模型未返回 html 时保持原文。
 */
import type { LlmClient } from "../../ai/llm-client.ts";
import { AppError } from "../../lib/errors.ts";

const SYSTEM = [
  "你改写一封营销邮件的 HTML 正文。",
  "只输出一个 JSON 对象：{\"html\":\"...\"}。",
  "保留所有 {{变量}} 原样，不要翻译变量名，不要新增事实。"
].join("");

export async function improveDraft(llm: LlmClient | null, html: string, instruction: string): Promise<string> {
  if (!llm) throw new AppError("AI_DISABLED", "尚未配置语言模型，无法改进正文");
  const raw = await llm.complete({
    system: SYSTEM,
    user: `要求：${instruction}\n\nHTML：\n${html}`,
    json: true,
    max_tokens: 4096
  });
  try {
    const parsed = JSON.parse(raw) as { html?: unknown };
    if (typeof parsed.html === "string" && parsed.html.trim()) return parsed.html;
  } catch {
    // 模型没有返回可解析的 JSON 时保留原文。
  }
  return html;
}
