import { getTranslations } from "next-intl/server";
import { SettingsNav } from "@/components/edm/settings/settings-nav";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("Pages");
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("settingsTitle")}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t("settingsDesc")}</p>
      </div>
      <div className="flex flex-col gap-5 lg:flex-row">
        <aside className="shrink-0 lg:w-44">
          <SettingsNav />
        </aside>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
