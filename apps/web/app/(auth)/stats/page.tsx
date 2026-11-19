import { StatsOverview } from "@/components/edm/campaigns/stats-overview";
import { generateMeta } from "@/lib/utils";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const t = await getTranslations("Pages");
  return generateMeta({ title: t("statsTitle"), description: t("statsDesc") });
}

export default function Page() {
  return <StatsOverview />;
}
