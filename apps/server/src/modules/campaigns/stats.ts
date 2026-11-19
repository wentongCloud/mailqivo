import { and, desc, eq, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import type { CampaignMessageDto, CampaignMessageQuery, CampaignOpensByHour, CampaignStats, ReasonCode, SkipReason } from "@mailqivo/shared";
import type { Db } from "../../db/client.ts";
import { messages } from "../../db/schema.ts";
import { toPage, type PageParams } from "../../lib/pagination.ts";
import { getCampaignRow } from "./service.ts";

type Aggregate = {
  total: number; skipped: number; in_flight: number; sent: number; failed: number; unknown: number;
  bounced: number; opened: number; opened_incl_suspect: number; clicked: number; replied: number;
};
const ratio = (numerator: number, denominator: number) => denominator ? numerator / denominator : 0;

/** §10.3 唯一统计口径；单次聚合扫描活动消息，试发永不计入。 */
export async function getCampaignStats(db: Db, campaignId: string): Promise<CampaignStats> {
  await getCampaignRow(db, campaignId);
  const [aggregate, failures, skipped] = await Promise.all([
    db.execute<Aggregate>(sql`
      SELECT
        count(*) FILTER (WHERE status <> 'skipped')::int AS total,
        count(*) FILTER (WHERE status = 'skipped')::int AS skipped,
        count(*) FILTER (WHERE status IN ('pending_ai','queued','sending'))::int AS in_flight,
        count(*) FILTER (WHERE status = 'sent')::int AS sent,
        count(*) FILTER (WHERE status = 'failed')::int AS failed,
        count(*) FILTER (WHERE status = 'unknown')::int AS unknown,
        count(*) FILTER (WHERE status = 'sent' AND bounce_type IS NOT NULL)::int AS bounced,
        count(*) FILTER (WHERE status = 'sent' AND bounce_type IS NULL AND first_opened_at IS NOT NULL AND open_suspect = false)::int AS opened,
        count(*) FILTER (WHERE status = 'sent' AND bounce_type IS NULL AND first_opened_at IS NOT NULL)::int AS opened_incl_suspect,
        count(*) FILTER (WHERE status = 'sent' AND bounce_type IS NULL AND first_clicked_at IS NOT NULL)::int AS clicked,
        count(*) FILTER (WHERE status = 'sent' AND bounce_type IS NULL AND replied_at IS NOT NULL)::int AS replied
      FROM messages WHERE campaign_id = ${campaignId} AND is_test = false
    `),
    db.execute<{ reason: ReasonCode; count: number }>(sql`
      SELECT reason, count(*)::int AS count FROM (
        SELECT failure_reason AS reason FROM messages
        WHERE campaign_id = ${campaignId} AND is_test = false AND status = 'failed' AND failure_reason IS NOT NULL
        UNION ALL
        SELECT bounce_reason AS reason FROM messages
        WHERE campaign_id = ${campaignId} AND is_test = false AND status = 'sent' AND bounce_type IS NOT NULL AND bounce_reason IS NOT NULL
      ) reasons GROUP BY reason ORDER BY count DESC, reason
    `),
    db.execute<{ reason: SkipReason; count: number }>(sql`
      SELECT skip_reason AS reason, count(*)::int AS count FROM messages
      WHERE campaign_id = ${campaignId} AND is_test = false AND status = 'skipped' AND skip_reason IS NOT NULL
      GROUP BY skip_reason ORDER BY count DESC, skip_reason
    `)
  ]);
  const value = aggregate.rows[0]!;
  const delivered = value.sent - value.bounced;
  return {
    ...value,
    delivered,
    delivery_rate: ratio(delivered, value.total),
    open_rate: ratio(value.opened, delivered),
    click_rate: ratio(value.clicked, delivered),
    reply_rate: ratio(value.replied, delivered),
    failure_breakdown: failures.rows,
    skipped_by_reason: skipped.rows
  };
}

const iso = (date: Date | null) => date?.toISOString() ?? null;

export async function listCampaignMessages(db: Db, campaignId: string, filter: CampaignMessageQuery, page: PageParams) {
  await getCampaignRow(db, campaignId);
  const conditions: SQL[] = [eq(messages.campaign_id, campaignId), eq(messages.is_test, false)];
  if (filter.status) conditions.push(eq(messages.status, filter.status));
  if (filter.failure_reason) conditions.push(eq(messages.failure_reason, filter.failure_reason));
  if (filter.bounce_reason) conditions.push(eq(messages.bounce_reason, filter.bounce_reason));
  if (filter.opened !== undefined) conditions.push(filter.opened ? isNotNull(messages.first_opened_at) : isNull(messages.first_opened_at));
  if (filter.replied !== undefined) conditions.push(filter.replied ? isNotNull(messages.replied_at) : isNull(messages.replied_at));
  const where = and(...conditions);
  const [counted, rows] = await Promise.all([
    db.select({ total: sql<number>`count(*)::int` }).from(messages).where(where),
    db.select().from(messages).where(where).orderBy(desc(messages.created_at), desc(messages.id)).limit(page.limit).offset(page.offset)
  ]);
  const items: CampaignMessageDto[] = rows.map((row) => ({
    id: row.id, tracking_id: row.tracking_id, campaign_id: row.campaign_id, contact_id: row.contact_id,
    email: row.email, status: row.status as CampaignMessageDto["status"], skip_reason: row.skip_reason,
    attempt: row.attempt, smtp_code: row.smtp_code, smtp_response: row.smtp_response,
    failure_reason: row.failure_reason, bounce_reason: row.bounce_reason, rendered_subject: row.rendered_subject,
    sent_at: iso(row.sent_at), bounced_at: iso(row.bounced_at), first_opened_at: iso(row.first_opened_at),
    open_count: row.open_count, first_clicked_at: iso(row.first_clicked_at), replied_at: iso(row.replied_at),
    created_at: row.created_at.toISOString()
  }));
  return toPage(items, counted[0]!.total, page);
}

export async function getCampaignOpensByHour(db: Db, campaignId: string, includeSuspect: boolean): Promise<CampaignOpensByHour> {
  await getCampaignRow(db, campaignId);
  const result = await db.execute<{ hour: Date | string; opens: number }>(sql`
    SELECT date_trunc('hour', e.ts) AS hour, count(*)::int AS opens
    FROM tracking_events e JOIN messages m ON m.id = e.message_id
    WHERE m.campaign_id = ${campaignId} AND m.is_test = false AND e.type = 'open'
      AND (${includeSuspect} = true OR e.suspected_machine = false)
    GROUP BY 1 ORDER BY 1
  `);
  return result.rows.map((row) => ({ hour: new Date(row.hour).toISOString(), opens: row.opens }));
}
