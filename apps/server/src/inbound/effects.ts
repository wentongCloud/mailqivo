import { eq, sql } from "drizzle-orm";
import { REASON_CODE_META, type BounceType, type ReasonCode } from "@mailqivo/shared";
import type { Db } from "../db/client.ts";
import { contactTags, contacts, messages } from "../db/schema.ts";
import { applyUnsubscribe } from "../modules/contacts/service.ts";
import { findOrCreateTags } from "../modules/tags/service.ts";

type MessageRow = typeof messages.$inferSelect;

/** 退信副作用已移至 `apply-bounce.ts` 的 applyBounceEffect（§4.1 V1.1）。 */
export function bounceTypeForReason(reason: ReasonCode): BounceType {
  // SENDER_* 没有 bounce_type；DSN 里出现时按 soft 记（与 V1.0 一致）
  return REASON_CODE_META[reason].bounceType ?? "soft";
}

export async function applyAutoReply(db: Db, message: MessageRow, now = new Date()) {
  await db.transaction(async (tx) => {
    const trx = tx as unknown as Db;
    await trx.update(messages).set({ auto_replied_at: sql`coalesce(${messages.auto_replied_at}, ${now})` }).where(eq(messages.id, message.id));
    if (!message.contact_id) return;
    const ids = await findOrCreateTags(trx, ["建议节后重发"]);
    const tagId = ids.get("建议节后重发");
    if (tagId) await trx.insert(contactTags).values({ contact_id: message.contact_id, tag_id: tagId }).onConflictDoNothing();
  });
}

export async function applyHumanReply(db: Db, message: MessageRow, intent: string | null, now = new Date()) {
  await db.transaction(async (tx) => {
    const trx = tx as unknown as Db;
    await trx.update(messages).set({ replied_at: sql`coalesce(${messages.replied_at}, ${now})` }).where(eq(messages.id, message.id));
    if (!message.contact_id) return;
    await trx.update(contacts).set({ soft_bounce_streak: 0, updated_at: now }).where(eq(contacts.id, message.contact_id));
    if (intent === "unsubscribe_request") await applyUnsubscribe(trx, { contact_id: message.contact_id });
  });
}
