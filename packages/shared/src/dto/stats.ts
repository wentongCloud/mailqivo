import { z } from "zod";
import { MESSAGE_STATUS_VALUES, REASON_CODE_VALUES, type MessageStatus, type ReasonCode, type SkipReason } from "../enums.ts";

/** §11.5 打开率旁固定说明（活动详情、/stats）。 */
export { OPEN_RATE_DISCLAIMER } from "../i18n/labels.ts";

export type CampaignStats = {
  total: number;
  skipped: number;
  in_flight: number;
  sent: number;
  failed: number;
  unknown: number;
  bounced: number;
  delivered: number;
  opened: number;
  opened_incl_suspect: number;
  clicked: number;
  replied: number;
  delivery_rate: number;
  open_rate: number;
  click_rate: number;
  reply_rate: number;
  failure_breakdown: { reason: ReasonCode; count: number }[];
  skipped_by_reason: { reason: SkipReason; count: number }[];
};

export type CampaignMessageDto = {
  id: string;
  tracking_id: string;
  campaign_id: string;
  contact_id: string | null;
  email: string;
  status: MessageStatus;
  skip_reason: string | null;
  attempt: number;
  smtp_code: number | null;
  smtp_response: string | null;
  failure_reason: string | null;
  bounce_reason: string | null;
  rendered_subject: string | null;
  sent_at: string | null;
  bounced_at: string | null;
  first_opened_at: string | null;
  open_count: number;
  first_clicked_at: string | null;
  replied_at: string | null;
  created_at: string;
};

const optionalBoolean = z.string().optional().transform((value) => value === "1" || value === "true" ? true : value === "0" || value === "false" ? false : undefined);
export const CampaignMessageQuery = z.object({
  status: z.enum(MESSAGE_STATUS_VALUES).optional(),
  failure_reason: z.enum(REASON_CODE_VALUES).optional(),
  bounce_reason: z.enum(REASON_CODE_VALUES).optional(),
  opened: optionalBoolean,
  replied: optionalBoolean
});
export type CampaignMessageQuery = z.infer<typeof CampaignMessageQuery>;

export type CampaignOpensByHour = { hour: string; opens: number }[];
