import { generateMeta } from "@/lib/utils";
import { getTranslations } from "next-intl/server";
import ContactsTable from "@/components/edm/contacts/contacts-table";

export async function generateMetadata() {
  const t = await getTranslations("Pages");
  return generateMeta({ title: t("contactsTitle"), description: t("contactsDesc") });
}

export default function Page() {
  return (
    <div className="space-y-4">
      <ContactsTable />
    </div>
  );
}
