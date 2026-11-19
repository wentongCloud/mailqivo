import { and, desc, eq, getTableColumns, sql, type SQL } from "drizzle-orm";
import { REASON_CODE_META, ReplyQuery, type ReplyCounts, type ReplyDetail, type ReplyListItem, type ReplyPatchBody, type ReplyQuery as ReplyQueryInput } from "@mailqivo/shared";
import type { Db } from "../../db/client.ts";
import { campaigns, inboundMails, messages } from "../../db/schema.ts";
import { applyBounceEffect } from "../../inbound/apply-bounce.ts";
import { bounceTypeForReason } from "../../inbound/effects.ts";
import { Errors, parseOrThrow } from "../../lib/errors.ts";
import { parsePagination, toPage } from "../../lib/pagination.ts";

type Row = typeof inboundMails.$inferSelect & { campaign_id: string | null; campaign_name: string | null };
const selection = {
  ...getTableColumns(inboundMails),
  campaign_id: messages.campaign_id,
  campaign_name: campaigns.name
};
const iso = (value: Date) => value.toISOString();

function whereFor(query: ReplyQueryInput, counts = false): SQL | undefined {
  const conditions = [
    query.campaign_id ? eq(messages.campaign_id, query.campaign_id) : undefined,
    !counts && query.category ? eq(inboundMails.category, query.category) : undefined,
    !counts && query.intent ? eq(inboundMails.intent, query.intent) : undefined,
    !counts && query.handled !== undefined ? eq(inboundMails.handled, query.handled) : undefined,
    !counts && query.needs_review !== undefined ? eq(inboundMails.needs_review, query.needs_review) : undefined
  ];
  return and(...conditions.filter((v) => v !== undefined));
}

function toListItem(row: Row): ReplyListItem {
  return {
    id: row.id, channel_id: row.channel_id, campaign_id: row.campaign_id, campaign_name: row.campaign_name,
    from_email: row.from_email, subject: row.subject, received_at: iso(row.received_at),
    category: row.category as ReplyListItem["category"], intent: row.intent as ReplyListItem["intent"],
    summary: row.summary, preview: (row.body_text ?? "").replace(/\s+/g, " ").trim().slice(0, 180),
    handled: row.handled, needs_review: row.needs_review, reason_code: row.reason_code as ReplyListItem["reason_code"]
  };
}

export async function listReplies(db: Db, rawQuery: unknown) {
  const query = parseOrThrow(ReplyQuery, rawQuery);
  const page = parsePagination(rawQuery);
  const from = db.select(selection).from(inboundMails).leftJoin(messages, eq(messages.id, inboundMails.message_id)).leftJoin(campaigns, eq(campaigns.id, messages.campaign_id));
  const rows = await from.where(whereFor(query)).orderBy(desc(inboundMails.received_at), desc(inboundMails.id)).limit(page.limit).offset(page.offset) as Row[];
  const countFrom = db.select({ total: sql<number>`count(*)::int` }).from(inboundMails).leftJoin(messages, eq(messages.id, inboundMails.message_id));
  const [counted] = await countFrom.where(whereFor(query));
  const grouped = await db.select({ category: inboundMails.category, needs_review: inboundMails.needs_review, count: sql<number>`count(*)::int` })
    .from(inboundMails).leftJoin(messages, eq(messages.id, inboundMails.message_id)).where(whereFor(query, true))
    .groupBy(inboundMails.category, inboundMails.needs_review);
  const counts: ReplyCounts = { human: 0, auto_reply: 0, bounce: 0, unrelated: 0, needs_review: 0 };
  for (const row of grouped) {
    if (row.category) counts[row.category as keyof ReplyCounts] += row.count;
    if (row.needs_review) counts.needs_review += row.count;
  }
  return { ...toPage(rows.map(toListItem), counted?.total ?? 0, page), counts };
}

export async function getReply(db: Db, id: string): Promise<ReplyDetail> {
  const [row] = await db.select(selection).from(inboundMails).leftJoin(messages, eq(messages.id, inboundMails.message_id))
    .leftJoin(campaigns, eq(campaigns.id, messages.campaign_id)).where(eq(inboundMails.id, id)).limit(1) as Row[];
  if (!row) throw Errors.notFound("回函不存在");
  const { preview: _preview, ...item } = toListItem(row);
  return {
    ...item, rfc_message_id: row.rfc_message_id, imap_uid: row.imap_uid, uid_validity: row.uid_validity,
    message_id: row.message_id, match_method: row.match_method as ReplyDetail["match_method"], body_text: row.body_text,
    bounce_type: row.bounce_type as ReplyDetail["bounce_type"], dsn_status: row.dsn_status, diagnostic: row.diagnostic,
    suggested_reply: row.suggested_reply
  };
}

export async function updateReply(db: Db, id: string, body: ReplyPatchBody) {
  const current = await getReply(db, id);
  if (body.category === "bounce" && !body.reason_code) throw Errors.validation("改为退信时必须提供原因", [{ path: "reason_code", message: "必填" }]);
  await db.transaction(async (tx) => {
    const trx = tx as unknown as Db;
    await trx.update(inboundMails).set({
      ...(body.category !== undefined ? { category: body.category } : {}),
      ...(body.intent !== undefined ? { intent: body.intent } : {}),
      ...(body.handled !== undefined ? { handled: body.handled } : {}),
      ...(body.reason_code ? { reason_code: body.reason_code, bounce_type: REASON_CODE_META[body.reason_code].bounceType } : {}),
      needs_review: false
    }).where(eq(inboundMails.id, id));
    if (body.category === "bounce" && body.reason_code && current.message_id) {
      // 同一 message 已生效过则不重复（§9 edm_reply_update）
      await applyBounceEffect(trx, { message_id: current.message_id, bounce_type: bounceTypeForReason(body.reason_code), reason_code: body.reason_code });
    }
  });
  return getReply(db, id);
}
