/**
 * 退信效果的唯一生效函数（§4.1 V1.1）。IMAP DSN、回函改分类为 bounce、POST /webhooks/bounce 共用。
 *
 * 幂等键为 message：一封 message 的退信效果至多生效一次。同一 message 的后续退信（任何来源、任何类型）
 * 不生效，也不改写首次的 bounce_type / bounced_at，因此 IMAP 与 webhook 交叉重复、同源重复都不会重复计数。
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { SOFT_BOUNCE_REPEATED, SOFT_BOUNCE_STREAK_LIMIT, type BounceType, type ReasonCode } from "@mailqivo/shared";
import type { Db } from "../db/client.ts";
import { contacts, messages } from "../db/schema.ts";

export type ApplyBounceEffectInput = {
  message_id: string;
  bounce_type: BounceType;
  reason_code: ReasonCode;
};

/** `db` 可以是事务（嵌套时 drizzle 使用 savepoint）。 */
export async function applyBounceEffect(db: Db, input: ApplyBounceEffectInput): Promise<{ applied: boolean }> {
  return db.transaction(async (tx) => {
    const trx = tx as unknown as Db;
    const [row] = await trx
      .update(messages)
      .set({ bounce_type: input.bounce_type, bounce_reason: input.reason_code, bounced_at: sql`now()` })
      .where(and(
        eq(messages.id, input.message_id),
        eq(messages.is_test, false),
        eq(messages.status, "sent"),
        isNull(messages.bounced_at)
      ))
      .returning({ contact_id: messages.contact_id });
    if (!row) return { applied: false };
    if (!row.contact_id) return { applied: true };

    const [contact] = await trx.select().from(contacts).where(eq(contacts.id, row.contact_id)).for("update");
    if (!contact) return { applied: true };
    const active = contact.status === "active";
    const streak = active && input.bounce_type === "soft" ? contact.soft_bounce_streak + 1 : contact.soft_bounce_streak;
    const toBounced = active && input.bounce_type === "hard";
    const toInvalid = active && input.bounce_type === "soft" && streak >= SOFT_BOUNCE_STREAK_LIMIT;
    await trx
      .update(contacts)
      .set({
        bounce_count: sql`${contacts.bounce_count} + 1`,
        last_bounce_at: sql`now()`,
        soft_bounce_streak: streak,
        ...(toBounced ? { status: "bounced", invalid_reason: input.reason_code } : {}),
        ...(toInvalid ? { status: "invalid", invalid_reason: SOFT_BOUNCE_REPEATED } : {}),
        updated_at: sql`now()`
      })
      .where(eq(contacts.id, contact.id));
    return { applied: true };
  });
}
