import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import type { MailChannel, OutgoingMail, SendReceipt, SmtpChannelOptions, SmtpVerifyResult, VerifyResult } from "./channel.ts";
import { buildMimeOptions } from "./mime.ts";

type SmtpError = Error & { responseCode?: number; response?: string; code?: string };

export type ImapVerifyClient = {
  usable: boolean;
  connect(): Promise<void>;
  getMailboxLock(path: string): Promise<{ release(): void }>;
  logout(): Promise<void>;
  close(): void;
};
export type ImapClientFactory = (options: SmtpChannelOptions["imap"]) => ImapVerifyClient;

const defaultImapFactory: ImapClientFactory = (imap) => new ImapFlow({
  host: imap.host,
  port: imap.port,
  secure: imap.secure,
  auth: imap.user || imap.pass ? { user: imap.user, pass: imap.pass } : undefined,
  logger: false,
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 15000
});

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

export class SmtpChannel implements MailChannel {
  /** 持久模式下复用的连接池（TCP + TLS + AUTH 只做一次）。 */
  private pooled: ReturnType<typeof nodemailer.createTransport> | undefined;

  /**
   * @param persistent true：send 复用同一个连接池，直到 close()；供发送 worker 按通道缓存。
   *   false（默认）：每次 send 建连并关闭，适合试发 / 校验等一次性调用。
   */
  constructor(
    private readonly options: SmtpChannelOptions,
    private readonly imapFactory: ImapClientFactory = defaultImapFactory,
    private readonly persistent = false
  ) {}

  close(): void {
    this.pooled?.close();
    this.pooled = undefined;
  }

  private transport() {
    const { smtp } = this.options;
    return nodemailer.createTransport({
      pool: true,
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      // secure=false 表示显式 STARTTLS/明文连接，而不是禁止 TLS。
      // 保持 Nodemailer 默认的 STARTTLS 协商，587 submission 才能正常升级。
      ignoreTLS: false,
      auth: smtp.user || smtp.pass ? { user: smtp.user, pass: smtp.pass } : undefined,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000
    });
  }

  async send(mail: OutgoingMail): Promise<SendReceipt> {
    const transporter = this.persistent ? (this.pooled ??= this.transport()) : this.transport();
    try {
      const info = await transporter.sendMail(buildMimeOptions(this.options, mail));
      const response = info.response || "250 OK";
      const code = Number(response.match(/^\d{3}/)?.[0] ?? 250);
      return { ok: true, code, response };
    } catch (error) {
      const err = error as SmtpError;
      const response = err.response || err.message;
      return {
        ok: false,
        code: err.responseCode,
        enh: response.match(/^\d{3}\s+([245]\.\d{1,3}\.\d{1,3})/)?.[1],
        response,
        errCode: err.code
      };
    } finally {
      if (!this.persistent) transporter.close();
    }
  }

  async verify(): Promise<VerifyResult> {
    const [smtp, imap] = await Promise.all([this.verifySmtp(), this.verifyImap()]);
    const errors = [
      smtp.error ? `SMTP：${smtp.error}` : "",
      imap.error ? `IMAP：${imap.error}` : ""
    ].filter(Boolean);
    return {
      smtp: smtp.ok,
      imap: imap.ok,
      ...(errors.length ? { error: errors.join("；") } : {})
    };
  }

  /** 只探测 SMTP 连接与认证。发送确认提交使用；设置页的通道测试由 verify() 组合 SMTP 与 IMAP。 */
  async verifySmtp(): Promise<SmtpVerifyResult> {
    const transporter = this.transport();
    try {
      await transporter.verify();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    } finally {
      transporter.close();
    }
  }

  private async verifyImap(): Promise<{ ok: boolean; error?: string }> {
    const client = this.imapFactory(this.options.imap);
    let connected = false;
    let lock: { release(): void } | undefined;
    try {
      await client.connect();
      connected = true;
      lock = await client.getMailboxLock("INBOX");
      return { ok: true };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    } finally {
      lock?.release();
      if (connected) {
        try {
          await client.logout();
        } catch {
          client.close();
        }
      } else {
        client.close();
      }
    }
  }
}
