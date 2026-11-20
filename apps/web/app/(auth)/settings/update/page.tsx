import { UpdateManager } from "@/components/edm/settings/update-manager";
import { generateMeta } from "@/lib/utils";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const t = await getTranslations("Pages");
  return generateMeta({ title: t("updateTitle"), description: t("updateDesc") });
}

export default function Page() {
  return <UpdateManager />;
}
