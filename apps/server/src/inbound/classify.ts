import type { InboundCategory } from "@mailqivo/shared";
import type { ParsedInbound } from "./types.ts";

function header(mail: ParsedInbound, name: string): string {
  const value = mail.headers.get(name);
  return value == null ? "" : typeof value === "string" ? value : JSON.stringify(value);
}

export function classifyInbound(mail: ParsedInbound): Exclude<InboundCategory, "human"> {
  const contentType = header(mail, "content-type").toLowerCase();
  const from = mail.from?.text ?? header(mail, "from");
  const subject = mail.subject ?? "";
  const precedence = header(mail, "precedence").toLowerCase();
  const autoSubmitted = header(mail, "auto-submitted").toLowerCase();
  if (contentType.includes("multipart/report") && contentType.includes("report-type=delivery-status") ||
      /mailer-daemon|postmaster/i.test(from) ||
      /退信|undeliver|delivery status notification|mail delivery failed|returned mail|系统退信|投递失败/i.test(subject)) {
    return "bounce";
  }
  if ((autoSubmitted && autoSubmitted !== "no") || mail.headers.has("x-autoreply") || mail.headers.has("x-autorespond") ||
      ["auto_reply", "bulk", "junk"].includes(precedence) ||
      /自动回复|auto(matic)?[ -]?reply|out of office|休假|不在办公室/i.test(subject)) {
    return "auto_reply";
  }
  return "unrelated";
}
