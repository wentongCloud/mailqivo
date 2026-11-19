import type { SendMailOptions } from "nodemailer";
import type { OutgoingMail, SmtpChannelOptions } from "./channel.ts";

/** 统一构造 RFC 邮件头；text + html 由 nodemailer 生成 multipart/alternative。 */
export function buildMimeOptions(
  channel: Pick<SmtpChannelOptions, "from_email" | "from_name" | "reply_to" | "mailIdDomain">,
  mail: OutgoingMail
): SendMailOptions {
  const attachments = mail.attachments?.length
    ? {
        // nodemailer 在 text + html + attachments 时生成 multipart/mixed 包裹 multipart/alternative；
        // 非 ASCII 文件名由 nodemailer 按 RFC 2231（filename*=utf-8''…）编码。
        attachments: mail.attachments.map((a) => ({
          filename: a.filename,
          contentType: a.contentType,
          content: a.content,
          contentDisposition: "attachment" as const
        }))
      }
    : {};
  return {
    from: { name: channel.from_name, address: channel.from_email },
    replyTo: channel.reply_to,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    ...attachments,
    messageId: `<${mail.tracking_id}@${channel.mailIdDomain}>`,
    headers: {
      "X-EDM-Tracking-Id": mail.tracking_id,
      "X-EDM-Campaign-Id": mail.campaign_id,
      "List-Unsubscribe": `<${mail.unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
    }
  };
}
