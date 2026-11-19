import React from "react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { cn } from "@/lib/utils";
import { ThemeProvider } from "next-themes";
import { fontVariables } from "@/lib/fonts";
import NextTopLoader from "nextjs-toploader";

import "./globals.css";

import { ActiveThemeProvider } from "@/components/active-theme";
import { DEFAULT_THEME } from "@/lib/themes";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DM_Sans } from "next/font/google";

const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-sans" });

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Meta");
  return {
    title: t("title"),
    description: t("description")
  };
}

export default async function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();
  const cookieStore = await cookies();
  const themeSettings = {
    preset: (cookieStore.get("theme_preset")?.value ?? DEFAULT_THEME.preset) as any,
    color: (cookieStore.get("theme_color")?.value ?? DEFAULT_THEME.color) as any,
    chartPreset: (cookieStore.get("theme_chart_preset")?.value ?? DEFAULT_THEME.chartPreset) as any,
    scale: (cookieStore.get("theme_scale")?.value ?? DEFAULT_THEME.scale) as any,
    radius: (cookieStore.get("theme_radius")?.value ?? DEFAULT_THEME.radius) as any,
    contentLayout: (cookieStore.get("theme_content_layout")?.value ??
      DEFAULT_THEME.contentLayout) as any,
    sidebarVariant: (cookieStore.get("theme_sidebar_variant")?.value ??
      DEFAULT_THEME.sidebarVariant) as any,
    sidebarCollapsible: (cookieStore.get("theme_sidebar_collapsible")?.value ??
      DEFAULT_THEME.sidebarCollapsible) as any,
    font: (cookieStore.get("theme_font")?.value ?? DEFAULT_THEME.font) as any,
    displayFont: (cookieStore.get("theme_display_font")?.value ??
      DEFAULT_THEME.displayFont) as any
  };

  const bodyAttributes = Object.fromEntries(
    Object.entries(themeSettings)
      .filter(([_, value]) => value)
      .map(([key, value]) => [`data-theme-${key.replace(/([A-Z])/g, "-$1").toLowerCase()}`, value])
  );

  return (
    <html lang={locale} suppressHydrationWarning className={cn("font-sans", dmSans.variable)}>
      <body
        suppressHydrationWarning
        className={cn("bg-background group/layout font-sans", fontVariables)}
        {...bodyAttributes}>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange>
            <ActiveThemeProvider initialTheme={themeSettings}>
              <TooltipProvider>
                {children}
                <Toaster position="top-center" richColors />
                <NextTopLoader color="var(--primary)" showSpinner={false} height={2} shadow-sm="none" />
              </TooltipProvider>
            </ActiveThemeProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
