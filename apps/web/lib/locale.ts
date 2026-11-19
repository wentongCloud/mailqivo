"use client";

import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE_NAME,
  parseAppLocale,
  type AppLocale
} from "@mailqivo/shared";

const ONE_YEAR = 60 * 60 * 24 * 365;

export function readLocaleCookie(): AppLocale {
  if (typeof document === "undefined") return DEFAULT_LOCALE;
  const match = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE_NAME}=([^;]*)`));
  return parseAppLocale(match ? decodeURIComponent(match[1]!) : DEFAULT_LOCALE);
}

export function writeLocaleCookie(locale: AppLocale) {
  document.cookie = `${LOCALE_COOKIE_NAME}=${encodeURIComponent(locale)}; Path=/; Max-Age=${ONE_YEAR}; SameSite=Lax`;
}
