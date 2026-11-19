import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE_NAME,
  parseAppLocale,
  type AppLocale
} from "@mailqivo/shared";

async function loadMessages(locale: AppLocale) {
  switch (locale) {
    case "zh-CN":
      return (await import("../messages/zh-CN.json")).default;
    case "en-GB":
    default:
      return (await import("../messages/en-GB.json")).default;
  }
}

export default getRequestConfig(async () => {
  const store = await cookies();
  const locale = parseAppLocale(store.get(LOCALE_COOKIE_NAME)?.value ?? DEFAULT_LOCALE);
  return {
    locale,
    messages: await loadMessages(locale)
  };
});
