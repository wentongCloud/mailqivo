import { SignatureManager } from "@/components/edm/settings/signature-manager";
import { generateMeta } from "@/lib/utils";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const t = await getTranslations("Pages");
  return generateMeta({ title: t("signaturesTitle"), description: t("signaturesDesc") });
}
export default function Page() { return <SignatureManager />; }
