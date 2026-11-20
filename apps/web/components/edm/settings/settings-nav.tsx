"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Braces, CircleArrowUp, FileText, Paperclip, PenLine, Server, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function SettingsNav() {
  const pathname = usePathname();
  const t = useTranslations("Settings");
  const items = [
    { title: t("channels"), href: "/settings/channels", icon: Server },
    { title: t("signatures"), href: "/settings/signatures", icon: PenLine },
    { title: t("templates"), href: "/settings/templates", icon: FileText },
    { title: t("placeholders"), href: "/settings/placeholders", icon: Braces },
    { title: t("assets"), href: "/settings/assets", icon: Paperclip },
    { title: t("compliance"), href: "/settings/compliance", icon: ShieldCheck },
    { title: t("update"), href: "/settings/update", icon: CircleArrowUp }
  ];
  return (
    <Card className="py-0">
      <CardContent className="p-2">
        <nav className="flex gap-1 overflow-x-auto lg:flex-col">
          {items.map((item) => (
            <Button
              key={item.href}
              variant="ghost"
              className={`shrink-0 justify-start ${pathname === item.href ? "bg-muted" : ""}`}
              asChild
            >
              <Link href={item.href}>
                <item.icon />
                {item.title}
              </Link>
            </Button>
          ))}
        </nav>
      </CardContent>
    </Card>
  );
}
