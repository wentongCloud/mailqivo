"use client";

import * as React from "react";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useIsTablet } from "@/hooks/use-mobile";
import Link from "next/link";

import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar
} from "@/components/ui/sidebar";
import { useThemeConfig } from "@/components/active-theme";
import { SidebarCollapsible, SidebarVariant } from "@/lib/themes";
import { NavMain } from "@/components/layout/sidebar/nav-main";
import Search from "@/components/layout/sidebar/search";
import { ScrollArea } from "@/components/ui/scroll-area";
import Logo from "@/components/layout/logo";

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname();
  const { setOpen, setOpenMobile, isMobile } = useSidebar();
  const { theme } = useThemeConfig();
  const isTablet = useIsTablet();

  useEffect(() => {
    if (isMobile) setOpenMobile(false);
  }, [pathname]);

  const prevIsTablet = React.useRef(isTablet);
  useEffect(() => {
    // On mount, keep the state restored from the cookie; only react to
    // actual breakpoint changes afterwards.
    if (prevIsTablet.current !== isTablet) {
      prevIsTablet.current = isTablet;
      setOpen(!isTablet);
    }
  }, [isTablet]);

  return (
    <Sidebar
      collapsible={theme.sidebarCollapsible as SidebarCollapsible}
      variant={theme.sidebarVariant as SidebarVariant}
      {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="hover:text-foreground h-10 group-data-[collapsible=icon]:px-0!">
              <Link href="/campaigns">
                <Logo />
                <span className="text-foreground font-semibold">Mailqivo</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <Search />
      </SidebarHeader>
      <SidebarContent>
        <ScrollArea className="h-full [&>[data-slot=scroll-area-viewport]]:scroll-fade">
          <NavMain />
        </ScrollArea>
      </SidebarContent>
    </Sidebar>
  );
}
