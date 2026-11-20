import type { ParsedInbound } from "./types.ts";

export type DsnInfo = {
  action: string | null;
  status: string | null;
  diagnostic: string | null;
  /** 退信收件人（Final-Recipient，缺省取 Original-Recipient），小写；原邮件已删除时据此找联系人。 */
  recipient: string | null;
};

function fields(text: string): Map<string, string> {
  const result = new Map<string, string>();
  const unfolded = text.replace(/\r?\n[ \t]+/g, " ");
  for (const line of unfolded.split(/\r?\n/)) {
    const match = line.match(/^(Action|Status|Diagnostic-Code|Final-Recipient|Original-Recipient)\s*:\s*(.*)$/i);
    if (match && !result.has(match[1]!.toLowerCase())) result.set(match[1]!.toLowerCase(), match[2]!.trim());
  }
  return result;
}

/** `rfc822; user@example.com` → `user@example.com`；不是邮箱地址时返回 null。 */
function recipientAddress(value: string | undefined): string | null {
  const address = value?.split(";").pop()?.trim().replace(/^<|>$/g, "").toLowerCase() ?? "";
  return /^[^\s@]+@[^\s@]+$/.test(address) ? address : null;
}

/** 从 message/delivery-status 附件读取 DSN；不规范邮件退回全文扫描。 */
export function parseDsn(mail: ParsedInbound): DsnInfo {
  const parts = mail.attachments.filter((part) => /delivery-status/i.test(part.contentType));
  const source = parts.map((part) => Buffer.isBuffer(part.content) ? part.content.toString("utf8") : String(part.content)).join("\n") || mail.raw;
  const parsed = fields(source);
  return {
    action: parsed.get("action") ?? null,
    status: parsed.get("status")?.match(/[245]\.\d{1,3}\.\d{1,3}/)?.[0] ?? null,
    diagnostic: parsed.get("diagnostic-code") ?? null,
    recipient: recipientAddress(parsed.get("final-recipient") ?? parsed.get("original-recipient"))
  };
}
