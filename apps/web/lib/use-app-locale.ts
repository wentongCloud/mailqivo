"use client";

import { useLocale } from "next-intl";
import { enGB, zhCN } from "date-fns/locale";
import {
  campaignStatusLabelMap,
  commonLabel,
  consentSourceLabelMap,
  contactStatusLabelMap,
  importFieldLabelMap,
  importIssueLabelMap,
  parseAppLocale,
  reasonCodeDisplay,
  skipReasonLabelI18n,
  templateCategoryLabelMap,
  type AppLocale,
  type ReasonCode
} from "@mailqivo/shared";

export function useAppLocale(): AppLocale {
  return parseAppLocale(useLocale());
}

export function useDateFnsLocale() {
  return useAppLocale() === "zh-CN" ? zhCN : enGB;
}

export function useLocalizedLabels() {
  const locale = useAppLocale();
  return {
    locale,
    dateLocale: locale === "zh-CN" ? zhCN : enGB,
    contactStatus: contactStatusLabelMap(locale),
    campaignStatus: campaignStatusLabelMap(locale),
    consentSource: consentSourceLabelMap(locale),
    importIssue: importIssueLabelMap(locale),
    importField: importFieldLabelMap(locale),
    templateCategory: templateCategoryLabelMap(locale),
    skipReason: (reason: string) => skipReasonLabelI18n(reason, locale),
    reasonCode: (code: ReasonCode) => reasonCodeDisplay(code, locale),
    common: (key: Parameters<typeof commonLabel>[0]) => commonLabel(key, locale)
  };
}
