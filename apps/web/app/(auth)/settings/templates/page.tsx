import { TemplateManager } from "@/components/edm/settings/template-manager";
import { generateMeta } from "@/lib/utils";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const t = await getTranslations("Pages");
  return generateMeta({ title: t("templatesTitle"), description: t("templatesDesc") });
}
export default function Page() { return <TemplateManager />; }
