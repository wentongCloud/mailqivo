import { CampaignEditor } from "@/components/edm/campaigns/campaign-editor";
import { generateMeta } from "@/lib/utils";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const t = await getTranslations("Pages");
  return generateMeta({ title: t("campaignNewTitle"), description: t("campaignNewDesc") });
}

export default function Page() {
  return <CampaignEditor />;
}
