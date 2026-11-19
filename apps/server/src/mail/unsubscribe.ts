import { createHmac } from "node:crypto";
import type { Config } from "../config.ts";
import { Errors } from "../lib/errors.ts";

export type UnsubscribeConfig = Pick<Config, "UNSUBSCRIBE_PUBLIC_URL" | "UNSUBSCRIBE_SHARED_SECRET" | "MAIL_PUBLIC_BASE_URL">;

export function assertUnsubscribeConfigured(config: UnsubscribeConfig) {
  if (config.UNSUBSCRIBE_PUBLIC_URL && config.UNSUBSCRIBE_SHARED_SECRET) return;
  if (!config.UNSUBSCRIBE_PUBLIC_URL && !config.UNSUBSCRIBE_SHARED_SECRET && config.MAIL_PUBLIC_BASE_URL) return;
  throw Errors.validation("请先配置公网退订服务 UNSUBSCRIBE_PUBLIC_URL 和 UNSUBSCRIBE_SHARED_SECRET，再发送邮件。");
}

export function unsubscribeUrl(config: UnsubscribeConfig, trackingId: string) {
  assertUnsubscribeConfigured(config);
  if (config.UNSUBSCRIBE_PUBLIC_URL && config.UNSUBSCRIBE_SHARED_SECRET) {
    const payload = Buffer.from(JSON.stringify({ v: 1, id: trackingId })).toString("base64url");
    const signature = createHmac("sha256", config.UNSUBSCRIBE_SHARED_SECRET).update(payload).digest("base64url");
    const url = new URL(config.UNSUBSCRIBE_PUBLIC_URL);
    url.searchParams.set("t", `${payload}.${signature}`);
    return url.href;
  }
  return `${config.MAIL_PUBLIC_BASE_URL}/u/${trackingId}`;
}
