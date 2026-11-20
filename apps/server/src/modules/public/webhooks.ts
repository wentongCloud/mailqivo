/**
 * `POST /webhooks/bounce`：通用退信 / 投诉上报（§10.2 V1.1）。Bearer `MCP_TOKEN` 鉴权；不实现厂商签名。
 *
 * - hard / soft → applyBounceEffect：能定位原邮件时 message 级幂等；原邮件已随活动删除时按 email 对通讯录联系人生效。
 * - complaint → applyUnsubscribe。
 * - 只匹配 is_test=false 的 message；不写 inbound_mails；source / diagnostic 只进结构化日志。
 * - 受理（含重复、无状态变化）一律 202 { accepted: true, applied }。
 */
import type { FastifyPluginAsync } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import { BOUNCE_WEBHOOK_REASONS, BounceWebhookBody, type BounceWebhookResult, type ReasonCode } from "@mailqivo/shared";
import type { Db } from "../../db/client.ts";
import { messages } from "../../db/schema.ts";
import { applyBounceEffect } from "../../inbound/apply-bounce.ts";
import { bearerMatches } from "../../lib/bearer.ts";
import { Errors, parseOrThrow } from "../../lib/errors.ts";
import { applyUnsubscribe, findContactIdByEmail } from "../contacts/service.ts";

type MessageRow = typeof messages.$inferSelect;

/** 定位 message（只看 is_test=false）；字段冲突抛 VALIDATION。找不到返回 null。 */
async function locateMessage(db: Db, body: BounceWebhookBody): Promise<MessageRow | null> {
  if (body.tracking_id) {
    const [message] = await db.select().from(messages)
      .where(and(eq(messages.tracking_id, body.tracking_id), eq(messages.is_test, false)));
    if (!message) return null;
    if (body.email !== undefined && body.email !== message.email.toLowerCase()) {
      throw Errors.validation("email 与 tracking_id 对应的邮件不一致", [{ path: "email", message: "与 tracking_id 不符" }]);
    }
    if (body.campaign_id !== undefined && body.campaign_id !== message.campaign_id) {
      throw Errors.validation("campaign_id 与 tracking_id 对应的邮件不一致", [{ path: "campaign_id", message: "与 tracking_id 不符" }]);
    }
    return message;
  }
  const [message] = await db.select().from(messages)
    .where(and(
      eq(messages.email, body.email!),
      eq(messages.is_test, false),
      eq(messages.status, "sent"),
      body.campaign_id ? eq(messages.campaign_id, body.campaign_id) : undefined
    ))
    .orderBy(desc(messages.sent_at), desc(messages.created_at))
    .limit(1);
  return message ?? null;
}

export const webhookRoutes: FastifyPluginAsync = async (app) => {
  // onRequest：在解析请求体之前鉴权，无 token 时返回 401 而不是 400
  app.addHook("onRequest", async (request) => {
    if (!bearerMatches(request.headers.authorization, app.config.MCP_TOKEN)) throw Errors.unauthorized("Token 无效");
  });

  app.post("/bounce", async (request, reply) => {
    const body = parseOrThrow(BounceWebhookBody, request.body);
    const message = await locateMessage(app.db, body);
    let applied: boolean;
    let reasonCode: ReasonCode | null = null;

    if (body.type === "complaint") {
      // SPEC-GAP: message 已定位但 contact_id 为空（联系人已删除）时，同样按 email 回退查找联系人。
      const contactId = message?.contact_id ?? await findContactIdByEmail(app.db, body.email ?? message?.email);
      if (!contactId) throw Errors.notFound("找不到对应的邮件或联系人");
      ({ applied } = await applyUnsubscribe(app.db, { contact_id: contactId }));
    } else {
      // 原邮件已随活动删除时，退信按 email 对通讯录联系人生效（§4.1）。
      const target = message ? { message_id: message.id } : await findContactIdByEmail(app.db, body.email).then((id) => id ? { contact_id: id } : null);
      if (!target) throw Errors.notFound("找不到对应的邮件或联系人");
      reasonCode = body.reason_code ?? BOUNCE_WEBHOOK_REASONS[body.type][0];
      ({ applied } = await applyBounceEffect(app.db, { ...target, bounce_type: body.type, reason_code: reasonCode }));
    }

    request.log.info({
      webhook: "bounce",
      source: body.source,
      diagnostic: body.diagnostic,
      type: body.type,
      reason_code: reasonCode,
      message_id: message?.id ?? null,
      applied
    }, "bounce webhook accepted");
    const result: BounceWebhookResult = { accepted: true, applied };
    return reply.status(202).send(result);
  });
};
