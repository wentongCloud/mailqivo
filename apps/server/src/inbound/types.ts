import type { ParsedMail } from "mailparser";

export type InboundSourceItem = {
  uid: number;
  raw: Buffer;
};

/** 可替换的 IMAP 数据源；测试使用内存实现，不访问外部邮箱。 */
export interface InboundSource {
  connect(): Promise<void>;
  openInbox(): Promise<{ uidValidity: number }>;
  fetchAfter(uid: number, limit?: number): Promise<InboundSourceItem[]>;
  close(): Promise<void>;
}

export type ParsedInbound = ParsedMail & { raw: string };
