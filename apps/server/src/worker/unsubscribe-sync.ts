import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Config } from "../config.ts";
import type { Db } from "../db/client.ts";
import { messages, settings } from "../db/schema.ts";
import { applyUnsubscribe } from "../modules/contacts/service.ts";

type FeedConfig = Pick<Config, "UNSUBSCRIBE_PUBLIC_URL" | "UNSUBSCRIBE_SHARED_SECRET">;
const sequence = z.number().int().nonnegative();
const pageSize = 100;
const pageSchema = z.object({
  events: z.array(z.object({ seq: sequence.positive(), id: z.guid() })).max(pageSize)
});

export async function syncUnsubscribeEvents(db: Db, config: FeedConfig, fetchEvents: typeof fetch = fetch) {
  const { UNSUBSCRIBE_PUBLIC_URL: endpoint, UNSUBSCRIBE_SHARED_SECRET: secret } = config;
  if (!endpoint && !secret) return;
  if (!endpoint || !secret) throw new Error("公网退订同步配置不完整");
  const url = new URL(endpoint);
  const key = `unsubscribe_cursor:${url.href}`;
  const [stored] = await db.select().from(settings).where(eq(settings.key, key));
  let after = stored ? sequence.parse(stored.value) : 0;
  url.searchParams.set("events", "1");

  for (;;) {
    url.searchParams.set("after", String(after));
    const response = await fetchEvents(url, {
      headers: { Authorization: `Bearer ${secret}` },
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) throw new Error(`公网退订事件读取失败（HTTP ${response.status}）`);
    const { events } = pageSchema.parse(await response.json());
    if (!events.length) return;
    let last = after;
    for (const event of events) {
      if (event.seq <= last) throw new Error("公网退订事件序号未递增");
      last = event.seq;
    }
    // Fetch outside the transaction. A concurrent worker may have committed this page already.
    after = await db.transaction(async (tx) => {
      await tx.insert(settings).values({ key, value: 0 }).onConflictDoNothing();
      const [cursor] = await tx.select().from(settings).where(eq(settings.key, key)).for("update");
      const committed = sequence.parse(cursor!.value);
      if (last <= committed) return committed;
      const ids = events.filter(event => event.seq > committed).map(event => event.id);
      const recipients = await tx.selectDistinct({ id: messages.contact_id }).from(messages)
        .where(and(inArray(messages.tracking_id, ids), eq(messages.is_test, false)));
      for (const { id } of recipients) {
        if (id) await applyUnsubscribe(tx as unknown as Db, { contact_id: id });
      }
      await tx.update(settings).set({ value: last }).where(eq(settings.key, key));
      return last;
    });
    if (events.length < pageSize) return;
  }
}
