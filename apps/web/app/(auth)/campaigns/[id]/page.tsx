import { CampaignDetail } from "@/components/edm/campaigns/campaign-detail";
import { generateMeta } from "@/lib/utils";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const t = await getTranslations("Pages");
  return generateMeta({ title: t("campaignDetailTitle"), description: t("campaignDetailDesc") });
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CampaignDetail id={id} />;
}
