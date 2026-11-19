/** §8.2 / §8.4 提示词。区块生成的系统提示为规格原文，不得改写。 */
import { REPLY_INTENT_VALUES } from "@mailqivo/shared";

/** §8.2 系统提示（原文），`{max_chars}` 为占位符。 */
export const BLOCK_SYSTEM_PROMPT_TEMPLATE =
  "你是企业营销邮件撰写助手。根据【活动目标】和【段落要求】，为指定收件人撰写一段邮件正文。规则：1. 只能使用【收件人信息】中出现的事实，不得编造合作历史、订单、职位、头衔或任何未提供的信息；2. 信息不足时写通用但得体的内容；3. 不写称呼行和签名；4. 不超过 {max_chars} 个字；5. 输出 JSON：{\"text\": \"...\"}。";

export function blockSystemPrompt(maxChars: number): string {
  return BLOCK_SYSTEM_PROMPT_TEMPLATE.replace("{max_chars}", String(maxChars));
}

export type BlockPromptInput = {
  ai_goal: string | null;
  instruction: string;
  /** 已按 ai_fields 白名单挑出的联系人字段。 */
  contact_fields: Record<string, string>;
  /** V1.1：只传命中规则的 matched_tags（不是联系人完整 Tags）。 */
  matched_tags: string[];
  /** V1.1：命中规则的 instruction。 */
  rule_instruction: string;
};

/**
 * §8.2 用户消息：`【活动目标】…\n【段落要求】…\n【收件人信息】{JSON}`；
 * V1.1 命中规则时追加 `\n【客户标签】{matched_tags}\n【本类客户要求】{instruction}`，无命中或为空时省略对应段。
 */
export function blockUserPrompt(input: BlockPromptInput): string {
  let message = `【活动目标】${input.ai_goal ?? ""}\n【段落要求】${input.instruction}\n【收件人信息】${JSON.stringify(input.contact_fields)}`;
  // SPEC-GAP: {matched_tags} 的序列化格式未规定；用 JSON 数组，与【收件人信息】一致且标签名含分隔符时无歧义。
  if (input.matched_tags.length) message += `\n【客户标签】${JSON.stringify(input.matched_tags)}`;
  if (input.rule_instruction.trim()) message += `\n【本类客户要求】${input.rule_instruction.trim()}`;
  return message;
}

// SPEC-GAP: §8.4 只规定了输入与输出 JSON 结构，未给出回函分类的提示词原文；以下为最简实现。
export const REPLY_SYSTEM_PROMPT =
  `你是企业邮件回函分类助手。阅读客户对营销邮件的回复，判断其意图。intent 只能取以下之一：${REPLY_INTENT_VALUES.join(" / ")}`
  + "（interested=有兴趣，inquiry=咨询，reject=拒绝，complaint=投诉，unsubscribe_request=要求退订，other=其他）。"
  + "summary 用不超过 100 字概括来信内容；suggested_reply 用不超过 200 字给出得体的建议回复，不得编造未提供的事实。"
  + "输出 JSON：{\"intent\": \"...\", \"summary\": \"...\", \"suggested_reply\": \"...\"}。";

export function replyUserPrompt(input: { subject: string; text: string }): string {
  return `【主题】${input.subject}\n【正文】${input.text}`;
}
