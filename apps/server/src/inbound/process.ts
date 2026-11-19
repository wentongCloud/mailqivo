import { and, eq } from "drizzle-orm";
import { simpleParser } from "mailparser";
import { REASON_CODE_META, type InboundCategory, type ReasonCode } from "@mailqivo/shared";
import type { Config } from "../config.ts";
import type { Db } from "../db/client.ts";
import { inboundMails } from "../db/schema.ts";
import { classifyInbound } from "./classify.ts";
import { parseDsn } from "./dsn.ts";
import { applyBounceEffect } from "./apply-bounce.ts";
import { applyAutoReply, applyHumanReply, bounceTypeForReason } from "./effects.ts";
import { matchBounce, matchReply } from "./match.ts";
import { classifyReason } from "./reason-rules.ts";
import { createInboundClassifier, removeQuotedText, type InboundClassifier, type ReplyClassification } from "./reply-classifier.ts";
import type { ParsedInbound } from "./types.ts";

export type InboundRuntime = Pick<Config, "MAIL_ID_DOMAIN" | "LLM_API_KEY" | "LLM_MOCK"> & Partial<Pick<Config, "LLM_MODEL" | "LLM_BASE_URL">>;
export type ProcessInboundInput = {
  channelId: string;
  uid: number;
  uidValidity: number;
  raw: Buffer | string;
  now?: Date;
};

export async function processInboundMail(db: Db, runtime: InboundRuntime, input: ProcessInboundInput, classifier?: InboundClassifier | null) {
  const now = input.now ?? new Date();
  // 先去重再解析 / 调用 LLM：重复轮询同一 UID 不得重复产生 AI 费用。
  const [existing] = await db.select({ id: inboundMails.id }).from(inboundMails).where(and(
    eq(inboundMails.channel_id, input.channelId),
    eq(inboundMails.uid_validity, input.uidValidity),
    eq(inboundMails.imap_uid, input.uid)
  )).limit(1);
  if (existing) return { duplicate: true as const, mail: null };
  const raw = Buffer.isBuffer(input.raw) ? input.raw.toString("utf8") : input.raw;
  const parsed = await simpleParser(input.raw);
  const mail = { ...parsed, raw } as ParsedInbound;
  let category: InboundCategory = classifyInbound(mail);
  const matched = category === "bounce" ? await matchBounce(db, mail, runtime.MAIL_ID_DOMAIN) : await matchReply(db, mail, runtime.MAIL_ID_DOMAIN, now);
  if (category !== "bounce") {
    if (!matched.message) category = "unrelated";
    else if (category !== "auto_reply") category = "human";
  }
  const dsn = category === "bounce" ? parseDsn(mail) : null;
  let reason: ReasonCode | null = null;
  if (dsn) {
    reason = classifyReason(dsn.status || dsn.diagnostic ? { enh: dsn.status ?? undefined, response: dsn.diagnostic ?? undefined } : { response: raw });
    const ai = classifier === undefined ? createInboundClassifier(runtime) : classifier;
    if (reason === "UNKNOWN" && dsn.action?.toLowerCase() !== "delayed" && ai?.classifyBounce) {
      reason = await ai.classifyBounce({ status: dsn.status, diagnostic: dsn.diagnostic, text: raw.slice(0, 4000) });
    }
  }
  let intent: ReplyClassification["intent"] = null;
  let summary: string | null = null;
  let suggestedReply: string | null = null;
  if (category === "human") {
    const ai = classifier === undefined ? createInboundClassifier(runtime) : classifier;
    if (ai) {
      const result = await ai.classifyReply({ subject: mail.subject ?? "", text: removeQuotedText(mail.text ?? "") });
      intent = result.intent;
      summary = result.summary ? result.summary.slice(0, 100) : null;
      suggestedReply = result.suggested_reply ? result.suggested_reply.slice(0, 200) : null;
    }
  }
  const needsReview = category === "bounce" && (!matched.message || reason === "UNKNOWN") || category === "human" && !intent;
  const values = {
    channel_id: input.channelId,
    imap_uid: input.uid,
    uid_validity: input.uidValidity,
    rfc_message_id: mail.messageId ?? null,
    from_email: mail.from?.value[0]?.address?.toLowerCase() ?? null,
    subject: mail.subject ?? null,
    received_at: mail.date ?? now,
    category,
    message_id: matched.message?.id ?? null,
    match_method: matched.match_method,
    body_text: (mail.text ?? "").slice(0, 20000),
    bounce_type: reason ? REASON_CODE_META[reason].bounceType : null,
    reason_code: reason,
    dsn_status: dsn?.status ?? null,
    diagnostic: dsn?.diagnostic ?? null,
    intent,
    summary,
    suggested_reply: suggestedReply,
    needs_review: needsReview
  };
  return db.transaction(async (tx) => {
    const [inserted] = await tx.insert(inboundMails).values(values).onConflictDoNothing().returning();
    if (!inserted) return { duplicate: true as const, mail: null };
    if (matched.message && dsn?.action?.toLowerCase() !== "delayed") {
      if (category === "bounce" && reason) {
        await applyBounceEffect(tx, { message_id: matched.message.id, bounce_type: bounceTypeForReason(reason), reason_code: reason });
      }
      if (category === "auto_reply") await applyAutoReply(tx, matched.message, now);
      if (category === "human") await applyHumanReply(tx, matched.message, intent, now);
    }
    return { duplicate: false as const, mail: inserted };
  });
}
