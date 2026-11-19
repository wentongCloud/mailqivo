import { AssetManager } from "@/components/edm/settings/asset-manager";
import { generateMeta } from "@/lib/utils";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const t = await getTranslations("Pages");
  return generateMeta({ title: t("assetsTitle"), description: t("assetsDesc") });
}

export default function Page() {
  return <AssetManager />;
}
