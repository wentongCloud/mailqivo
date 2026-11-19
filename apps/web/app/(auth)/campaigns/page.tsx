import { CampaignList } from "@/components/edm/campaigns/campaign-list";
import { generateMeta } from "@/lib/utils";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const t = await getTranslations("Pages");
  return generateMeta({ title: t("campaignsTitle"), description: t("campaignsDesc") });
}

export default function Page() {
  return <CampaignList />;
}
