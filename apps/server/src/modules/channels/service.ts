import { desc, eq, ne } from "drizzle-orm";
import { ChannelConfig, type ChannelBody, type ChannelDto } from "@mailqivo/shared";
import type { Config } from "../../config.ts";
import type { Db } from "../../db/client.ts";
import { campaigns, channels } from "../../db/schema.ts";
import { decryptConfig, encryptConfig } from "../../lib/crypto.ts";
import { Errors } from "../../lib/errors.ts";
import type { MailChannel } from "../../mail/channel.ts";
import type { UnsubscribeConfig } from "../../mail/unsubscribe.ts";
import { SmtpChannel } from "../../mail/smtp-channel.ts";

type Row = typeof channels.$inferSelect;
export type ChannelRuntimeConfig = Pick<Config, "APP_ENCRYPTION_KEY" | "MAIL_ID_DOMAIN"> & UnsubscribeConfig;

export function channelFromRow(row: Row, config: ChannelConfig): ChannelDto {
  const { pass: _smtpPass, ...smtp } = config.smtp;
  const { pass: _imapPass, ...imap } = config.imap;
  return {
    id: row.id,
    name: row.name,
    type: row.type as ChannelDto["type"],
    smtp,
    imap,
    from_email: row.from_email,
    from_name: row.from_name,
    reply_to: row.reply_to,
    rate_per_minute: row.rate_per_minute,
    daily_limit: row.daily_limit,
    is_default: row.is_default,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString()
  };
}

function readConfig(row: Row, runtime: ChannelRuntimeConfig): ChannelConfig {
  return ChannelConfig.parse(decryptConfig(row.config_enc, runtime.APP_ENCRYPTION_KEY));
}

async function getRow(db: Db, id: string): Promise<Row> {
  const [row] = await db.select().from(channels).where(eq(channels.id, id));
  if (!row) throw Errors.notFound("发送通道不存在");
  return row;
}

const values = (body: ChannelBody, runtime: ChannelRuntimeConfig, config?: ChannelConfig) => ({
  name: body.name,
  type: "smtp" as const,
  config_enc: encryptConfig(config ?? { smtp: body.smtp, imap: body.imap }, runtime.APP_ENCRYPTION_KEY),
  from_email: body.from_email,
  from_name: body.from_name,
  reply_to: body.reply_to,
  rate_per_minute: body.rate_per_minute,
  daily_limit: body.daily_limit,
  is_default: body.is_default
});

export async function listChannels(db: Db, runtime: ChannelRuntimeConfig) {
  const rows = await db.select().from(channels).orderBy(desc(channels.is_default), desc(channels.updated_at));
  return rows.map((row) => channelFromRow(row, readConfig(row, runtime)));
}

export async function getChannel(db: Db, id: string, runtime: ChannelRuntimeConfig) {
  const row = await getRow(db, id);
  return channelFromRow(row, readConfig(row, runtime));
}

function isDefaultChannelUniqueViolation(error: unknown): boolean {
  const pgError = error as { code?: string; constraint?: string } | null;
  return pgError?.code === "23505" && pgError.constraint === "channels_one_default";
}

export async function createChannel(db: Db, body: ChannelBody, runtime: ChannelRuntimeConfig) {
  // 并发设置默认通道时由唯一索引保证最多一个；冲突后重试，让后写入者转为默认。
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const id = await db.transaction(async (tx) => {
        const trx = tx as unknown as Db;
        if (body.is_default) await trx.update(channels).set({ is_default: false }).where(eq(channels.is_default, true));
        const [row] = await trx.insert(channels).values(values(body, runtime)).returning({ id: channels.id });
        return row!.id;
      });
      return getChannel(db, id, runtime);
    } catch (error) {
      if (!body.is_default || !isDefaultChannelUniqueViolation(error) || attempt === 2) throw error;
    }
  }
  throw new Error("unreachable");
}

export async function updateChannel(db: Db, id: string, body: ChannelBody, runtime: ChannelRuntimeConfig) {
  const previous = await getRow(db, id);
  if (previous.is_default && !body.is_default) {
    throw Errors.invalidState("请先将其他通道设为默认，再取消当前默认通道");
  }
  const oldConfig = readConfig(previous, runtime);
  const config: ChannelConfig = {
    smtp: { ...body.smtp, pass: body.smtp.pass || oldConfig.smtp.pass },
    imap: { ...body.imap, pass: body.imap.pass || oldConfig.imap.pass }
  };
  await db.transaction(async (tx) => {
    const trx = tx as unknown as Db;
    if (body.is_default) {
      await trx.update(channels).set({ is_default: false, updated_at: new Date() }).where(ne(channels.id, id));
    }
    await trx.update(channels).set({ ...values(body, runtime, config), updated_at: new Date() }).where(eq(channels.id, id));
  });
  return getChannel(db, id, runtime);
}

export async function deleteChannel(db: Db, id: string) {
  const row = await getRow(db, id);
  if (row.is_default) throw Errors.invalidState("默认通道不能删除，请先将其他通道设为默认");
  const [used] = await db.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.channel_id, id)).limit(1);
  if (used) throw Errors.invalidState("该通道已被活动使用，不能删除");
  await db.delete(channels).where(eq(channels.id, id));
}

/** T06/T07 共用的通道实例入口；密码只在此处解密。 */
export function createSmtpChannel(row: Row, config: ChannelConfig, runtime: ChannelRuntimeConfig, persistent = false) {
  return new SmtpChannel({
    ...config,
    from_email: row.from_email,
    from_name: row.from_name,
    reply_to: row.reply_to,
    mailIdDomain: runtime.MAIL_ID_DOMAIN
  }, undefined, persistent);
}

/** IMAP 轮询专用读取入口；密码仍只通过统一解密逻辑取得。 */
export async function getChannelImapConfig(db: Db, id: string, runtime: ChannelRuntimeConfig) {
  return readConfig(await getRow(db, id), runtime).imap;
}

export async function getChannelMailer(db: Db, id: string, runtime: ChannelRuntimeConfig) {
  const row = await getRow(db, id);
  return createSmtpChannel(row, readConfig(row, runtime), runtime);
}

export async function verifyChannel(db: Db, id: string, runtime: ChannelRuntimeConfig) {
  return (await getChannelMailer(db, id, runtime)).verify();
}

/**
 * 发送 worker 用的按通道缓存：同一通道复用一个持久 SMTP 连接池，避免每封邮件重新握手 / 登录。
 * 通道被修改（updated_at 变化）后关闭旧连接池并按新配置重建。
 */
export function createMailerCache() {
  const cache = new Map<string, { version: number; mailer: MailChannel }>();
  return {
    /** row 由调用方传入（已加载）时不再查库。 */
    async get(db: Db, id: string, runtime: ChannelRuntimeConfig, preloaded?: Row): Promise<MailChannel> {
      const row = preloaded ?? await getRow(db, id);
      const version = row.updated_at.getTime();
      const hit = cache.get(id);
      if (hit?.version === version) return hit.mailer;
      hit?.mailer.close?.();
      const mailer = createSmtpChannel(row, readConfig(row, runtime), runtime, true);
      cache.set(id, { version, mailer });
      return mailer;
    },
    close() {
      for (const { mailer } of cache.values()) mailer.close?.();
      cache.clear();
    }
  };
}
