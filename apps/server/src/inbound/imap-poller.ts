import { eq } from "drizzle-orm";
import { ImapFlow } from "imapflow";
import type { ChannelConfig } from "@mailqivo/shared";
import type { Db } from "../db/client.ts";
import { channels, settings } from "../db/schema.ts";
import { getChannelImapConfig } from "../modules/channels/service.ts";
import type { ChannelRuntimeConfig } from "../modules/channels/service.ts";
import { processInboundMail, type InboundRuntime } from "./process.ts";
import type { InboundClassifier } from "./reply-classifier.ts";
import type { InboundSource } from "./types.ts";

type Cursor = { uid_validity: number; last_uid: number };
const cursorKey = (channelId: string) => `imap_cursor:${channelId}`;

export function createImapSource(config: ChannelConfig["imap"]): InboundSource {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
    logger: false
  });
  return {
    connect: () => client.connect(),
    async openInbox() {
      const mailbox = await client.mailboxOpen("INBOX", { readOnly: true });
      return { uidValidity: Number(mailbox.uidValidity) };
    },
    async fetchAfter(uid, limit = 200) {
      const result = [];
      // RFC 3501：`n:*` 在没有新信时仍会返回最后一封（UID 可能 ≤ uid），必须过滤。
      for await (const message of client.fetch(`${uid + 1}:*`, { source: true, uid: true }, { uid: true })) {
        if (!message.source || message.uid <= uid) continue;
        result.push({ uid: message.uid, raw: message.source });
        if (result.length >= limit) break;
      }
      return result;
    },
    close: () => client.logout()
  };
}

export async function pollInboundSource(db: Db, runtime: InboundRuntime, channelId: string, source: InboundSource, classifier?: InboundClassifier | null) {
  await source.connect();
  try {
    const inbox = await source.openInbox();
    const [stored] = await db.select().from(settings).where(eq(settings.key, cursorKey(channelId)));
    const previous = stored?.value as Cursor | undefined;
    let lastUid = previous?.uid_validity === inbox.uidValidity ? previous.last_uid : 0;
    let processed = 0;
    const saveCursor = async () => {
      const value: Cursor = { uid_validity: inbox.uidValidity, last_uid: lastUid };
      await db.insert(settings).values({ key: cursorKey(channelId), value }).onConflictDoUpdate({ target: settings.key, set: { value } });
    };
    for (;;) {
      const batch = await source.fetchAfter(lastUid, 200);
      let advanced = false;
      for (const item of batch) {
        if (item.uid <= lastUid) continue;
        await processInboundMail(db, runtime, { channelId, uid: item.uid, uidValidity: inbox.uidValidity, raw: item.raw }, classifier);
        lastUid = item.uid;
        processed += 1;
        advanced = true;
        // 每封推进游标：崩溃后不会重新处理（及重复调用 LLM）已入库的信。
        await saveCursor();
      }
      if (!stored || previous?.uid_validity !== inbox.uidValidity) await saveCursor();
      if (batch.length < 200 || !advanced) break;
    }
    return { processed, last_uid: lastUid, uid_validity: inbox.uidValidity };
  } finally {
    await source.close();
  }
}

export async function pollAllChannels(db: Db, runtime: InboundRuntime & ChannelRuntimeConfig, classifier?: InboundClassifier | null) {
  const rows = await db.select({ id: channels.id }).from(channels);
  let processed = 0;
  const errors: { channel_id: string; error: string }[] = [];
  for (const row of rows) {
    try {
      const config = await getChannelImapConfig(db, row.id, runtime);
      if (!config.user && !config.pass) continue;
      const result = await pollInboundSource(db, runtime, row.id, createImapSource(config), classifier);
      processed += result.processed;
    } catch (error) {
      errors.push({ channel_id: row.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { processed, errors };
}
