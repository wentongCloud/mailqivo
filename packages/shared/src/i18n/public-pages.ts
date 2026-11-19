import { DEFAULT_LOCALE, type AppLocale } from "./locale.ts";

type PublicKey =
  | "invalidLinkTitle"
  | "invalidLinkBody"
  | "testMailTitle"
  | "testMailBody"
  | "testMailPostBody"
  | "confirmUnsubTitle"
  | "confirmUnsubButton"
  | "unsubscribedTitle"
  | "unsubscribedBody";

const PAGES: Record<AppLocale, Record<PublicKey, string>> = {
  "en-GB": {
    invalidLinkTitle: "Invalid link",
    invalidLinkBody: "This email could not be found.",
    testMailTitle: "Test email",
    testMailBody: "Test emails do not change subscription status.",
    testMailPostBody: "No action needed.",
    confirmUnsubTitle: "Confirm unsubscribe",
    confirmUnsubButton: "Confirm unsubscribe",
    unsubscribedTitle: "Unsubscribed",
    unsubscribedBody: "You have been unsubscribed from these marketing emails."
  },
  "zh-CN": {
    invalidLinkTitle: "链接无效",
    invalidLinkBody: "未找到这封邮件。",
    testMailTitle: "测试邮件",
    testMailBody: "测试邮件不会修改联系人的订阅状态。",
    testMailPostBody: "无需操作。",
    confirmUnsubTitle: "确认退订",
    confirmUnsubButton: "确认退订",
    unsubscribedTitle: "已退订",
    unsubscribedBody: "您已成功退订此类营销邮件。"
  }
};

export function publicPageText(key: PublicKey, locale: AppLocale = DEFAULT_LOCALE) {
  return PAGES[locale][key] ?? PAGES[DEFAULT_LOCALE][key];
}
