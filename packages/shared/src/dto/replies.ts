import { z } from "zod";
import { InboundCategorySchema, ReasonCodeSchema, ReplyIntentSchema, type BounceType, type InboundCategory, type MatchMethod, type ReasonCode, type ReplyIntent } from "../enums.ts";

export const ReplyQuery = z.object({
  campaign_id: z.uuid().optional(),
  category: InboundCategorySchema.optional(),
  intent: ReplyIntentSchema.optional(),
  handled: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
  needs_review: z.enum(["true", "false"]).transform((v) => v === "true").optional()
});
export type ReplyQuery = z.infer<typeof ReplyQuery>;

export const ReplyPatchBody = z.object({
  category: InboundCategorySchema.optional(),
  intent: ReplyIntentSchema.nullable().optional(),
  handled: z.boolean().optional(),
  reason_code: ReasonCodeSchema.optional()
}).refine((v) => Object.keys(v).some((key) => key !== "reason_code"), { message: "至少修改一个字段" });
export type ReplyPatchBody = z.infer<typeof ReplyPatchBody>;

export type ReplyCounts = Record<InboundCategory | "needs_review", number>;

export type ReplyListItem = {
  id: string;
  channel_id: string;
  campaign_id: string | null;
  campaign_name: string | null;
  from_email: string | null;
  subject: string | null;
  received_at: string;
  category: InboundCategory | null;
  intent: ReplyIntent | null;
  summary: string | null;
  preview: string;
  handled: boolean;
  needs_review: boolean;
  reason_code: ReasonCode | null;
};

export type ReplyDetail = Omit<ReplyListItem, "preview"> & {
  rfc_message_id: string | null;
  imap_uid: number;
  uid_validity: number;
  message_id: string | null;
  match_method: MatchMethod | null;
  body_text: string | null;
  bounce_type: BounceType | null;
  dsn_status: string | null;
  diagnostic: string | null;
  suggested_reply: string | null;
};
