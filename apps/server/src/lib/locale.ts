import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE_NAME,
  parseAppLocale,
  type AppLocale
} from "@mailqivo/shared";
import type { FastifyRequest } from "fastify";

/** Resolve locale from cookie, then Accept-Language, else default en-GB. */
export function localeFromRequest(request: FastifyRequest): AppLocale {
  const cookie = request.cookies?.[LOCALE_COOKIE_NAME];
  if (cookie) return parseAppLocale(cookie);

  const header = request.headers["accept-language"];
  if (typeof header === "string" && header.length > 0) {
    const first = header.split(",")[0]?.trim().split(";")[0];
    if (first) return parseAppLocale(first);
  }
  return DEFAULT_LOCALE;
}
