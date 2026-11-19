"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import type { AppLocale } from "@mailqivo/shared";
import { useSettings } from "@/lib/api/content";
import { writeLocaleCookie } from "@/lib/locale";

/** When logged in, settings.ui_locale is source of truth for the locale cookie. */
export function LocaleSync() {
  const { data } = useSettings();
  const locale = useLocale();
  const router = useRouter();

  useEffect(() => {
    if (!data?.ui_locale) return;
    if (data.ui_locale === locale) {
      writeLocaleCookie(data.ui_locale as AppLocale);
      return;
    }
    writeLocaleCookie(data.ui_locale as AppLocale);
    router.refresh();
  }, [data?.ui_locale, locale, router]);

  return null;
}
