/**
 * 退信效果的唯一生效函数（§4.1）。IMAP DSN、回函改分类为 bounce、POST /webhooks/bounce 共用。
 *
 * 退信属于通讯录联系人：硬退 → bounced，软退累计 streak，达到上限 → invalid。
 * - 传 message_id（原邮件仍在）：先按 message 做统计标记，联系人取 message.contact_id。幂等键为 message：
 *   同一 message 的后续退信（任何来源、任何类型）不生效，也不改写首次的 bounce_type / bounced_at。
 * - 传 contact_id（原邮件已随活动删除，调用方按退信邮箱找到联系人）：只对联系人生效，没有 message 级幂等；
 *   同一封退信若经 IMAP 与 webhook 各报一次，软退会多计一次。
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { SOFT_BOUNCE_REPEATED, SOFT_BOUNCE_STREAK_LIMIT, type BounceType, type ReasonCode } from "@mailqivo/shared";
import type { Db } from "../db/client.ts";
import { contacts, messages } from "../db/schema.ts";

export type ApplyBounceEffectInput = {
  bounce_type: BounceType;
  reason_code: ReasonCode;
} & ({ message_id: string } | { contact_id: string });

/** `db` 可以是事务（嵌套时 drizzle 使用 savepoint）。 */
export async function applyBounceEffect(db: Db, input: ApplyBounceEffectInput): Promise<{ applied: boolean }> {
  return db.transaction(async (tx) => {
    const trx = tx as unknown as Db;
    let contactId: string | null;
    if ("message_id" in input) {
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
      contactId = row.contact_id;
    } else {
      contactId = input.contact_id;
    }
    if (!contactId) return { applied: true };

    const [contact] = await trx.select().from(contacts).where(eq(contacts.id, contactId)).for("update");
    if (!contact) return { applied: "message_id" in input };
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
