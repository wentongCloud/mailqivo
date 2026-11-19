import crypto from "node:crypto";

/** `Authorization: Bearer <token>` 的常量时间比较（先 sha256 抹平长度差异）。供 /webhooks 与 /mcp 共用。 */
export function bearerMatches(header: string | undefined, token: string): boolean {
  const match = /^Bearer\s+(.+)$/i.exec(header ?? "");
  if (!match) return false;
  const a = crypto.createHash("sha256").update(match[1]!.trim()).digest();
  const b = crypto.createHash("sha256").update(token).digest();
  return crypto.timingSafeEqual(a, b);
}
