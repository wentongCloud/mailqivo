import type { ReasonCode } from "@mailqivo/shared";

export type ReasonInput = {
  code?: number | string;
  enh?: string;
  response?: string;
  errCode?: string;
};

export type ReasonRule = {
  id: string;
  matches: (input: ReasonInput) => boolean;
  reason: ReasonCode;
};

const basicCode = (input: ReasonInput) => {
  const parsed = Number(input.code);
  return Number.isInteger(parsed) ? parsed : undefined;
};
const enhancedCode = (input: ReasonInput) => input.enh ?? input.response?.match(/(?:^|\s)([245]\.\d{1,3}\.\d{1,3})(?:\s|$)/)?.[1];
const responseText = (input: ReasonInput) => `${input.response ?? ""} ${input.errCode ?? ""}`;

/** §4.2 有序规则；SMTP 会话错误和 T10 的 DSN 共用。 */
export const REASON_RULES: readonly ReasonRule[] = [
  {
    id: "sender-auth",
    reason: "SENDER_AUTH",
    matches: (input) => input.errCode === "EAUTH" || [535, 534, 530].includes(basicCode(input) ?? 0)
  },
  {
    id: "sender-rate-limit",
    reason: "SENDER_RATE_LIMIT",
    matches: (input) => {
      const code = basicCode(input);
      return !!code && ((code >= 400 && code < 500) || [550, 554, 451].includes(code)) &&
        /rate limit|too many|频率|超过.*限制|exceeded.*(quota|limit) for sender/i.test(responseText(input));
    }
  },
  {
    id: "address-not-exist",
    reason: "ADDR_NOT_EXIST",
    matches: (input) => ["5.1.1", "5.1.0", "5.1.10"].includes(enhancedCode(input) ?? "") ||
      /user unknown|does not exist|no such user|recipient not found|用户不存在|收件人不存在|mailbox not found/i.test(responseText(input))
  },
  {
    id: "address-domain-invalid",
    reason: "ADDR_DOMAIN_INVALID",
    matches: (input) => ["5.1.2", "5.4.4"].includes(enhancedCode(input) ?? "") || ["EDNS", "ENOTFOUND"].includes(input.errCode ?? "")
  },
  {
    id: "address-disabled",
    reason: "ADDR_DISABLED",
    matches: (input) => enhancedCode(input) === "5.2.1" || /disabled|deactivated|已停用|被冻结/i.test(responseText(input))
  },
  {
    id: "temporary-mailbox-full",
    reason: "TEMP_MAILBOX_FULL",
    matches: (input) => ["4.2.2", "5.2.2"].includes(enhancedCode(input) ?? "") || /quota|mailbox full|空间不足|容量已满/i.test(responseText(input))
  },
  {
    id: "policy-spam",
    reason: "POLICY_SPAM",
    matches: (input) => enhancedCode(input)?.startsWith("5.7.") === true || /spam|blocked|blacklist|垃圾邮件|拒收|reputation/i.test(responseText(input))
  },
  {
    id: "policy-content",
    reason: "POLICY_CONTENT",
    matches: (input) => enhancedCode(input)?.startsWith("5.6.") === true || enhancedCode(input) === "5.3.4" || /content rejected|message too large|内容/i.test(responseText(input))
  },
  {
    id: "temporary-server-busy",
    reason: "TEMP_SERVER_BUSY",
    matches: (input) => [421, 450, 451, 452].includes(basicCode(input) ?? 0) || enhancedCode(input)?.startsWith("4.") === true || ["ETIMEDOUT", "ECONNECTION"].includes(input.errCode ?? "")
  }
];

export function classifyReason(input: ReasonInput): ReasonCode {
  return REASON_RULES.find((rule) => rule.matches(input))?.reason ?? "UNKNOWN";
}
