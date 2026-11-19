import { PlaceholderManager } from "@/components/edm/settings/placeholder-manager";
import { generateMeta } from "@/lib/utils";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const t = await getTranslations("Pages");
  return generateMeta({ title: t("placeholdersTitle"), description: t("placeholdersDesc") });
}
export default function Page() { return <PlaceholderManager />; }
