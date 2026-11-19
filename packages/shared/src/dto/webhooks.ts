/** V1.1 通用退信 / 投诉上报 `POST /webhooks/bounce`（§10.2）。 */
import { z } from "zod";
import { ReasonCodeSchema, type ReasonCode } from "../enums.ts";

export const BOUNCE_WEBHOOK_TYPE_VALUES = ["hard", "soft", "complaint"] as const;

/** 各 type 允许的 reason_code（第一个为缺省值）；complaint 不接受 reason_code。 */
export const BOUNCE_WEBHOOK_REASONS = {
  hard: ["ADDR_NOT_EXIST", "ADDR_DOMAIN_INVALID", "ADDR_DISABLED"],
  soft: ["TEMP_SERVER_BUSY", "TEMP_MAILBOX_FULL"]
} as const satisfies Record<"hard" | "soft", readonly ReasonCode[]>;

export const BounceWebhookBody = z
  .object({
    email: z.string().trim().toLowerCase().pipe(z.email({ message: "邮箱格式不正确" })).optional(),
    tracking_id: z.uuid().optional(),
    campaign_id: z.uuid().optional(),
    type: z.enum(BOUNCE_WEBHOOK_TYPE_VALUES),
    reason_code: ReasonCodeSchema.optional(),
    source: z.string().trim().min(1).max(32),
    diagnostic: z.string().transform((v) => v.slice(0, 2000)).optional()
  })
  .refine((b) => b.email !== undefined || b.tracking_id !== undefined, {
    message: "email 与 tracking_id 至少提供一个",
    path: ["email"]
  })
  .superRefine((b, ctx) => {
    if (b.reason_code === undefined) return;
    const allowed: readonly string[] = b.type === "complaint" ? [] : BOUNCE_WEBHOOK_REASONS[b.type];
    if (!allowed.includes(b.reason_code)) {
      ctx.addIssue({ code: "custom", path: ["reason_code"], message: `reason_code 与 type=${b.type} 不一致` });
    }
  });
export type BounceWebhookBody = z.infer<typeof BounceWebhookBody>;

export type BounceWebhookResult = { accepted: true; applied: boolean };
