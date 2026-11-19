import { and, desc, eq, gte } from "drizzle-orm";
import type { MatchMethod } from "@mailqivo/shared";
import type { Db } from "../db/client.ts";
import { messages } from "../db/schema.ts";
import type { ParsedInbound } from "./types.ts";

type MessageRow = typeof messages.$inferSelect;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function headerIds(mail: ParsedInbound): string {
  return [mail.headers.get("in-reply-to"), mail.headers.get("references")]
    .map((value) => value == null ? "" : typeof value === "string" ? value : JSON.stringify(value)).join(" ");
}

async function byTracking(db: Db, trackingId: string): Promise<MessageRow | null> {
  const [message] = await db.select().from(messages).where(eq(messages.tracking_id, trackingId)).limit(1);
  return message ?? null;
}

export function extractTrackingId(text: string, mailIdDomain: string): string | null {
  return text.match(new RegExp(`X-EDM-Tracking-Id\\s*:\\s*<(${UUID})>`, "i"))?.[1] ??
    text.match(new RegExp(`<(${UUID})@${escapeRegExp(mailIdDomain)}>`, "i"))?.[1] ?? null;
}

export async function matchBounce(db: Db, mail: ParsedInbound, mailIdDomain: string): Promise<{ message: MessageRow | null; match_method: MatchMethod }> {
  const originalParts = mail.attachments.filter((part) => /rfc822/i.test(part.contentType))
    .map((part) => Buffer.isBuffer(part.content) ? part.content.toString("utf8") : String(part.content)).join("\n");
  const id = extractTrackingId(`${originalParts}\n${mail.raw}`, mailIdDomain);
  const message = id ? await byTracking(db, id) : null;
  return { message, match_method: message ? "header" : "none" };
}

export async function matchReply(db: Db, mail: ParsedInbound, mailIdDomain: string, now = new Date()): Promise<{ message: MessageRow | null; match_method: MatchMethod }> {
  const referenceId = extractTrackingId(headerIds(mail), mailIdDomain);
  if (referenceId) {
    const message = await byTracking(db, referenceId);
    if (message) return { message, match_method: "references" };
  }
  const from = mail.from?.value[0]?.address?.toLowerCase();
  if (!from) return { message: null, match_method: "none" };
  const [message] = await db.select().from(messages).where(and(
    eq(messages.email, from), eq(messages.status, "sent"), gte(messages.sent_at, new Date(now.getTime() - 30 * 86400_000))
  )).orderBy(desc(messages.sent_at), desc(messages.created_at)).limit(1);
  return { message: message ?? null, match_method: message ? "sender_recent" : "none" };
}
