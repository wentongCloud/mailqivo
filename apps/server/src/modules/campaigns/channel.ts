import { eq } from "drizzle-orm";
import type { Db } from "../../db/client.ts";
import { channels } from "../../db/schema.ts";
import { Errors } from "../../lib/errors.ts";
import type { CampaignRow } from "./render.ts";

/** 活动的发送通道：选定的通道，未选定时用默认通道。发送确认与试发共用。 */
export async function resolveCampaignChannel(db: Db, campaign: Pick<CampaignRow, "channel_id">): Promise<typeof channels.$inferSelect> {
  const where = campaign.channel_id ? eq(channels.id, campaign.channel_id) : eq(channels.is_default, true);
  const [channel] = await db.select().from(channels).where(where);
  if (!channel) throw Errors.validation(campaign.channel_id ? "所选发送通道不存在" : "没有可用的默认发送通道");
  return channel;
}
