"use client";

import React, { useEffect, useState } from "react";
import { SearchIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator
} from "@/components/ui/command";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarInput,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem
} from "@/components/ui/sidebar";
import { Label } from "@/components/ui/label";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { useNavItems } from "@/components/layout/sidebar/nav-main";

export default function Search() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const t = useTranslations("Nav");
  const navItems = useNavItems();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  return (
    <>
      <SidebarGroup className="py-0 group-data-[collapsible=icon]:hidden">
        <SidebarGroupContent className="relative">
          <Label htmlFor="sidebar-search" className="sr-only">
            {t("search")}
          </Label>
          <SidebarInput
            id="sidebar-search"
            placeholder={t("searchPh")}
            className="cursor-pointer pl-8"
            readOnly
            onClick={() => setOpen(true)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setOpen(true);
              }
            }}
          />
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 opacity-50 select-none" />
          <KbdGroup className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2">
            <Kbd>⌘K</Kbd>
          </KbdGroup>
        </SidebarGroupContent>
      </SidebarGroup>
      <SidebarMenu className="hidden group-data-[collapsible=icon]:flex">
        <SidebarMenuItem>
          <SidebarMenuButton tooltip={t("search")} onClick={() => setOpen(true)}>
            <SearchIcon />
            <span>{t("search")}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title={t("search")}
        description={t("searchPages")}>
        <CommandInput placeholder={t("searchPages")} />
        <CommandList>
          <CommandEmpty>{t("searchEmpty")}</CommandEmpty>
          {navItems.map((route) => (
            <React.Fragment key={route.title}>
              <CommandGroup heading={route.title}>
                {route.items.map((item, key) => (
                  <CommandItem
                    key={key}
                    onSelect={() => {
                      setOpen(false);
                      router.push(item.href);
                    }}>
                    {item.icon && <item.icon />}
                    <span>{item.title}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator />
            </React.Fragment>
          ))}
        </CommandList>
      </CommandDialog>
    </>
  );
}
