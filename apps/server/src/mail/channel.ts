import type { ChannelConfig } from "@mailqivo/shared";

/** V1.1 §6.5：附件（按顺序）；filename 可含中文，content 为已校验的文件内容。 */
export interface MailAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
}

export interface OutgoingMail {
  to: string;
  subject: string;
  html: string;
  text: string;
  tracking_id: string;
  unsubscribeUrl: string;
  campaign_id: string;
  /** 有附件时整体为 multipart/mixed = [multipart/alternative, 附件…] */
  attachments?: MailAttachment[];
}

export type SendReceipt =
  | { ok: true; code: number; response: string }
  | { ok: false; code?: number; enh?: string; response: string; errCode?: string };

export type VerifyResult = { smtp: boolean; imap: boolean; error?: string };
export type SmtpVerifyResult = { ok: boolean; error?: string };

export interface MailChannel {
  send(mail: OutgoingMail): Promise<SendReceipt>;
  verify(): Promise<VerifyResult>;
  verifySmtp(): Promise<SmtpVerifyResult>;
  /** 关闭长连接（持久模式的 SMTP 连接池）；一次性实例可不实现。 */
  close?(): void;
}

export type SmtpChannelOptions = ChannelConfig & {
  from_email: string;
  from_name: string;
  reply_to: string;
  mailIdDomain: string;
};
