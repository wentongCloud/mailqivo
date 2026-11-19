import { ImportWizard } from "@/components/edm/imports/import-wizard";
import { generateMeta } from "@/lib/utils";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const t = await getTranslations("Pages");
  return generateMeta({ title: t("importTitle"), description: t("importDesc") });
}

export default function Page() {
  return <ImportWizard />;
}
