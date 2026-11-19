"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useTranslations } from "next-intl";

import { Separator } from "@/components/ui/separator";
import ThemeSwitch from "@/components/layout/header/theme-switch";
import { LocaleSwitch } from "@/components/layout/header/locale-switch";
import UserMenu from "@/components/layout/header/user-menu";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";

// §11.1 第 5 条：顶栏保留主题切换、语言与用户菜单。
export function SiteHeader() {
  const { toggleSidebar, open } = useSidebar();
  const t = useTranslations("Nav");

  return (
    <header className="bg-background/40 sticky top-0 z-50 flex h-(--header-height) shrink-0 items-center gap-2 border-b backdrop-blur-md transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height) md:rounded-tl-xl md:rounded-tr-xl">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2">
        <Button onClick={toggleSidebar} size="icon" variant="ghost">
          {open ? <PanelLeftClose /> : <PanelLeftOpen />}
          <span className="sr-only">{t("toggleSidebar")}</span>
        </Button>

        <div className="ml-auto flex items-center gap-2">
          <LocaleSwitch />
          <ThemeSwitch />
          <Separator orientation="vertical" className="mx-2 data-[orientation=vertical]:h-4 data-[orientation=vertical]:self-center" />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
