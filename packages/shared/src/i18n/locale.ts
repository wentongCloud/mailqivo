import { z } from "zod";

/** UI / API locale identifiers (BCP 47). */
export const APP_LOCALE_VALUES = ["en-GB", "zh-CN"] as const;
export const AppLocaleSchema = z.enum(APP_LOCALE_VALUES);
export type AppLocale = z.infer<typeof AppLocaleSchema>;

export const DEFAULT_LOCALE: AppLocale = "en-GB";
export const LOCALE_COOKIE_NAME = "locale";

export const LOCALE_LABEL: Record<AppLocale, string> = {
  "en-GB": "English (UK)",
  "zh-CN": "简体中文"
};

/** Accept cookie / settings / Accept-Language-ish values; unknown → default. */
export function parseAppLocale(value: unknown): AppLocale {
  if (typeof value !== "string") return DEFAULT_LOCALE;
  const v = value.trim();
  if (v === "en-GB" || v === "en_GB") return "en-GB";
  if (v === "zh-CN" || v === "zh_CN" || v === "zh-Hans") return "zh-CN";
  if (v === "en" || v.toLowerCase().startsWith("en")) return "en-GB";
  if (v === "zh" || v.toLowerCase().startsWith("zh")) return "zh-CN";
  return DEFAULT_LOCALE;
}

export function dateFnsLocaleCode(locale: AppLocale): "enGB" | "zhCN" {
  return locale === "zh-CN" ? "zhCN" : "enGB";
}
