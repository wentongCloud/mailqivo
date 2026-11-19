import { ComplianceSettings } from "@/components/edm/settings/compliance-form";
import { generateMeta } from "@/lib/utils";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const t = await getTranslations("Pages");
  return generateMeta({ title: t("complianceTitle"), description: t("complianceDesc") });
}
export default function Page() { return <ComplianceSettings />; }
