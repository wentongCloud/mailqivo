import { ChannelManager } from "@/components/edm/settings/channel-manager";
import { generateMeta } from "@/lib/utils";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const t = await getTranslations("Pages");
  return generateMeta({ title: t("channelsTitle"), description: t("channelsDesc") });
}

export default function Page() {
  return <ChannelManager />;
}
