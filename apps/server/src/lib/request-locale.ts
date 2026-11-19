import { AsyncLocalStorage } from "node:async_hooks";
import { DEFAULT_LOCALE, type AppLocale } from "@mailqivo/shared";

const localeAls = new AsyncLocalStorage<AppLocale>();

/** Bind locale for the remainder of this request's async chain (Fastify onRequest). */
export function enterLocale(locale: AppLocale) {
  localeAls.enterWith(locale);
}

export function currentLocale(): AppLocale {
  return localeAls.getStore() ?? DEFAULT_LOCALE;
}
