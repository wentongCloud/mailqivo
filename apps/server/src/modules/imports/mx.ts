import dns from "node:dns/promises";
import { sql } from "drizzle-orm";
import type { Db } from "../../db/client.ts";
import { contacts } from "../../db/schema.ts";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const domainCache = new Map<string, { valid: boolean; expires: number }>();

export type DomainResolver = {
  resolveMx(domain: string): Promise<unknown[]>;
  resolve4(domain: string): Promise<string[]>;
};

/** 探测域名是否有 MX；MX 失败时按规格回退到 A 记录。结果缓存 24 小时。 */
export async function probeDomains(
  db: Db,
  emails: string[],
  resolver: DomainResolver = dns,
  now = Date.now()
): Promise<void> {
  const domains = [...new Set(emails.map((email) => email.split("@")[1]?.toLowerCase()).filter((v): v is string => Boolean(v)))];
  for (const domain of domains) {
    const cached = domainCache.get(domain);
    let valid: boolean;
    if (cached && cached.expires > now) {
      valid = cached.valid;
    } else {
      try {
        const mx = await resolver.resolveMx(domain);
        valid = mx.length > 0;
        if (!valid) throw new Error("MX 记录为空");
      } catch {
        try {
          valid = (await resolver.resolve4(domain)).length > 0;
        } catch {
          valid = false;
        }
      }
      domainCache.set(domain, { valid, expires: now + CACHE_TTL_MS });
    }
    if (!valid) {
      await db.update(contacts).set({ domain_suspect: true }).where(sql`split_part(${contacts.email}, '@', 2) = ${domain}`);
    }
  }
}

/** 导入提交不等待 DNS；少量并发避免一次导入产生大量并发 DNS 请求。 */
export function scheduleMxProbe(db: Db, emails: string[]): void {
  if (!emails.length) return;
  setImmediate(() => {
    void (async () => {
      for (let i = 0; i < emails.length; i += 20) await probeDomains(db, emails.slice(i, i + 20));
    })().catch(() => {
      // SPEC-GAP: MX 是辅助提示，异步失败不影响已完成的导入。
    });
  });
}
