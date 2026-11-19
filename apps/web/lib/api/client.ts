import {
  errorMessage,
  LOCALE_COOKIE_NAME,
  parseAppLocale,
  type ApiErrorBody,
  type AppLocale
} from "@mailqivo/shared";

/** 后端返回的 §5.2 错误 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ApiErrorBody["error"]
  ) {
    super(body.message);
    this.name = "ApiError";
  }
}

function clientLocale(): AppLocale {
  if (typeof document === "undefined") return parseAppLocale(undefined);
  const match = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE_NAME}=([^;]*)`));
  return parseAppLocale(match ? decodeURIComponent(match[1]!) : undefined);
}

/**
 * 调用 /api 的最小封装：同源请求（开发时经 next.config.ts 的 rewrites 转发到 apps/server），
 * 自动带 Cookie；非 2xx 时抛出 ApiError。后续任务在 lib/api/ 下基于它封装 TanStack Query hooks。
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  // FormData 必须由浏览器自动带 multipart boundary；勿强制 JSON Content-Type。
  if (init.body !== undefined && !headers.has("content-type") && !(init.body instanceof FormData)) {
    headers.set("content-type", "application/json");
  }
  const res = await fetch(path, { credentials: "same-origin", ...init, headers });
  const text = await res.text();
  const locale = clientLocale();
  let data: unknown;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      if (!res.ok) {
        throw new ApiError(res.status, {
          code: "INTERNAL",
          message: errorMessage("httpFailed", locale, { status: String(res.status) })
        });
      }
      throw new ApiError(res.status, {
        code: "INTERNAL",
        message: errorMessage("badJson", locale)
      });
    }
  }
  if (!res.ok) {
    const body = (data as ApiErrorBody | undefined)?.error ?? {
      code: "INTERNAL" as const,
      message: errorMessage("httpFailed", locale, { status: String(res.status) })
    };
    throw new ApiError(res.status, body);
  }
  return data as T;
}
