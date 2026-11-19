import { eq } from "drizzle-orm";
import type { Db } from "../../db/client.ts";
import { channels } from "../../db/schema.ts";
import { Errors } from "../../lib/errors.ts";
import type { CampaignRow } from "./render.ts";

export async function resolveChannelForTest(db: Db, campaign: CampaignRow) {
  const [channel] = await db.select().from(channels).where(campaign.channel_id ? eq(channels.id, campaign.channel_id) : eq(channels.is_default, true));
  if (!channel) throw Errors.validation("没有可用的发送通道");
  return channel;
}
