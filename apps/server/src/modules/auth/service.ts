/**
 * §5.1 Web UI 鉴权：单用户密码登录 + 签名的 httpOnly Cookie（7 天）。
 */
import crypto from "node:crypto";
import { SESSION_MAX_AGE_SEC } from "@mailqivo/shared";

/** 常量时间比较：先做 sha256 使两边长度一致，再 timingSafeEqual。 */
export function verifyPassword(input: string, expected: string): boolean {
  const a = crypto.createHash("sha256").update(input, "utf8").digest();
  const b = crypto.createHash("sha256").update(expected, "utf8").digest();
  return crypto.timingSafeEqual(a, b);
}

/**
 * 会话 Cookie 的明文内容：`v1.<过期时间毫秒>`，由 @fastify/cookie 用 SESSION_SECRET 签名。
 * SPEC-GAP: 规格未要求服务端会话存储；这里采用无状态 Cookie，登出只清除浏览器端 Cookie，
 * 已泄露的 Cookie 在过期前仍然有效（更换 SESSION_SECRET 可使所有会话失效）。
 */
export function createSessionValue(now = Date.now()): string {
  return `v1.${now + SESSION_MAX_AGE_SEC * 1000}`;
}

export function isSessionValueValid(value: string, now = Date.now()): boolean {
  const match = /^v1\.(\d+)$/.exec(value);
  if (!match) return false;
  return Number(match[1]) > now;
}
