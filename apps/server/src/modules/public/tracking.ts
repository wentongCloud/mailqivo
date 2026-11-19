import type { FastifyPluginAsync } from "fastify";
import { and, eq, gt, sql } from "drizzle-orm";
import type { Db } from "../../db/client.ts";
import { campaignLinks, contacts, messages, trackingEvents } from "../../db/schema.ts";
import { getMachineOpenPatterns } from "../settings/service.ts";

type MessageRow = typeof messages.$inferSelect;
const TRANSPARENT_GIF = Buffer.concat([Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"), Buffer.from("\n")]);

export function isSuspectedOpen(message: Pick<MessageRow, "sent_at">, userAgent: string, patterns: (string | RegExp)[], now = new Date()) {
  if (message.sent_at && now.getTime() - message.sent_at.getTime() < 10_000) return true;
  return patterns.some((pattern) => {
    if (pattern instanceof RegExp) return pattern.test(userAgent);
    try { return new RegExp(pattern, "i").test(userAgent); } catch { return false; }
  });
}

/** 只在确有连续软退计数时才写 contacts，避免每次打开 / 点击都更新联系人行。 */
async function clearSoftBounceStreak(db: Db, contactId: string | null, now: Date) {
  if (!contactId) return;
  await db.update(contacts).set({ soft_bounce_streak: 0, updated_at: now })
    .where(and(eq(contacts.id, contactId), gt(contacts.soft_bounce_streak, 0)));
}

export async function recordOpen(db: Db, message: MessageRow, input: { ip?: string; userAgent: string; now?: Date }) {
  const now = input.now ?? new Date();
  const suspected = isSuspectedOpen(message, input.userAgent, await getMachineOpenPatterns(db), now);
  await db.transaction(async (tx) => {
    const trx = tx as unknown as Db;
    await trx.insert(trackingEvents).values({
      message_id: message.id, type: "open", ts: now, ip: input.ip, ua: input.userAgent, suspected_machine: suspected
    });
    await trx.update(messages).set({
      first_opened_at: sql`coalesce(${messages.first_opened_at}, ${now})`,
      open_count: sql`${messages.open_count} + 1`,
      open_suspect: sql`case when ${messages.open_count} = 0 then ${suspected} else ${messages.open_suspect} and ${suspected} end`
    }).where(eq(messages.id, message.id));
    await clearSoftBounceStreak(trx, message.contact_id, now);
  });
}

export async function recordClick(db: Db, message: MessageRow, linkIdx: number, input: { ip?: string; userAgent: string; now?: Date }) {
  const now = input.now ?? new Date();
  await db.transaction(async (tx) => {
    const trx = tx as unknown as Db;
    await trx.insert(trackingEvents).values({
      message_id: message.id, type: "click", link_idx: linkIdx, ts: now, ip: input.ip, ua: input.userAgent, suspected_machine: false
    });
    await trx.update(messages).set({ first_clicked_at: sql`coalesce(${messages.first_clicked_at}, ${now})` }).where(eq(messages.id, message.id));
    await clearSoftBounceStreak(trx, message.contact_id, now);
  });
}

export const trackingRoutes: FastifyPluginAsync = async (app) => {
  app.get("/o/:tracking_id.gif", { config: { public: true } }, async (request, reply) => {
    const { tracking_id } = request.params as { tracking_id: string };
    const [message] = await app.db.select().from(messages).where(eq(messages.tracking_id, tracking_id));
    if (message) {
      void recordOpen(app.db, message, { ip: request.ip, userAgent: request.headers["user-agent"] ?? "" }).catch((error) => request.log.error({ error }, "记录打开事件失败"));
    }
    return reply.header("Cache-Control", "no-store").type("image/gif").send(TRANSPARENT_GIF);
  });

  app.get("/c/:tracking_id/:idx", { config: { public: true } }, async (request, reply) => {
    const { tracking_id, idx } = request.params as { tracking_id: string; idx: string };
    if (!/^\d+$/.test(idx)) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "链接不存在" } });
    const linkIdx = Number(idx);
    const [message] = await app.db.select().from(messages).where(eq(messages.tracking_id, tracking_id));
    if (!message) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "链接不存在" } });
    let target = message.click_targets?.[linkIdx];
    if (message.click_targets === null) {
      const [legacy] = await app.db.select({ url: campaignLinks.url }).from(campaignLinks)
        .where(and(eq(campaignLinks.campaign_id, message.campaign_id), eq(campaignLinks.idx, linkIdx)));
      target = legacy?.url;
    }
    if (!target || !URL.canParse(target)) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "链接不存在" } });
    void recordClick(app.db, message, linkIdx, { ip: request.ip, userAgent: request.headers["user-agent"] ?? "" }).catch((error) => request.log.error({ error }, "记录点击事件失败"));
    return reply.redirect(new URL(target).href, 302);
  });
};
