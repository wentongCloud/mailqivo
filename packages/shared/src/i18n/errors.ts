import { DEFAULT_LOCALE, type AppLocale } from "./locale.ts";

type ErrorKey =
  | "validation"
  | "notFound"
  | "unauthorized"
  | "internal"
  | "routeNotFound"
  | "httpFailed"
  | "badJson";

const ERRORS: Record<AppLocale, Record<ErrorKey, string>> = {
  "en-GB": {
    validation: "Invalid parameters",
    notFound: "Resource not found",
    unauthorized: "Not signed in or session expired",
    internal: "Internal server error",
    routeNotFound: "Route not found: {method} {url}",
    httpFailed: "Request failed (HTTP {status})",
    badJson: "Server returned an unreadable response"
  },
  "zh-CN": {
    validation: "参数不合法",
    notFound: "资源不存在",
    unauthorized: "未登录或登录已过期",
    internal: "服务器内部错误",
    routeNotFound: "路由不存在：{method} {url}",
    httpFailed: "请求失败（HTTP {status}）",
    badJson: "服务器返回了无法解析的响应"
  }
};

export function errorMessage(
  key: ErrorKey,
  locale: AppLocale = DEFAULT_LOCALE,
  vars?: Record<string, string>
): string {
  let text = ERRORS[locale][key] ?? ERRORS[DEFAULT_LOCALE][key];
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replaceAll(`{${k}}`, v);
    }
  }
  return text;
}
