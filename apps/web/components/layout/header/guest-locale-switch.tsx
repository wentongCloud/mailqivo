"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Languages } from "lucide-react";
import { APP_LOCALE_VALUES, LOCALE_LABEL, type AppLocale } from "@mailqivo/shared";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { writeLocaleCookie } from "@/lib/locale";

/** Cookie-only language switch for unauthenticated pages. */
export function GuestLocaleSwitch() {
  const t = useTranslations("Common");
  const locale = useLocale() as AppLocale;
  const router = useRouter();

  function select(next: AppLocale) {
    writeLocaleCookie(next);
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" aria-label={t("language")}>
          <Languages />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t("language")}</DropdownMenuLabel>
        {APP_LOCALE_VALUES.map((value) => (
          <DropdownMenuItem
            key={value}
            onClick={() => select(value)}
            className={value === locale ? "bg-muted" : undefined}
          >
            {LOCALE_LABEL[value]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
