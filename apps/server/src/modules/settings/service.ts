import { inArray, sql } from "drizzle-orm";
import {
  AttachmentMaxTotalMb,
  DEFAULT_SETTINGS,
  parseAppLocale,
  PrepareWarnRecipientThreshold,
  type SettingsBody,
  type SettingsDto
} from "@mailqivo/shared";
import type { Db } from "../../db/client.ts";
import { settings } from "../../db/schema.ts";
import { sanitizeEmailHtml } from "../../render/sanitize.ts";
import { TtlCache } from "../../lib/ttl-cache.ts";

const PUBLIC_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof SettingsDto)[];

export async function getSettings(db: Db): Promise<SettingsDto> {
  const rows = await db.select().from(settings).where(inArray(settings.key, PUBLIC_KEYS));
  const result: SettingsDto = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    const key = row.key as keyof SettingsDto;
    if (key === "ui_locale") {
      result.ui_locale = parseAppLocale(row.value);
      continue;
    }
    Object.assign(result, { [key]: row.value });
  }
  return result;
}

export async function updateSettings(db: Db, body: Partial<SettingsBody>): Promise<SettingsDto> {
  machineOpenPatterns.clear();
  const cleaned = { ...body };
  if (cleaned.footer_html !== undefined) cleaned.footer_html = sanitizeEmailHtml(cleaned.footer_html);
  return db.transaction(async (tx) => {
    const trx = tx as unknown as Db;
    for (const [key, value] of Object.entries(cleaned)) {
      await trx
        .insert(settings)
        .values({ key, value })
        .onConflictDoUpdate({ target: settings.key, set: { value: sql`excluded.value` } });
    }
    return getSettings(trx);
  });
}

export async function getPrepareWarnRecipientThreshold(db: Db): Promise<number> {
  return PrepareWarnRecipientThreshold.parse((await getSettings(db)).prepare_warn_recipient_threshold);
}

/** §5.5：上传、send 第一步与 worker 发送前读取。 */
export async function getAttachmentMaxTotalMb(db: Db): Promise<number> {
  return AttachmentMaxTotalMb.parse((await getSettings(db)).attachment_max_total_mb);
}

/**
 * 打开追踪热路径：机器打开 UA 正则编译后缓存 30 秒（本进程修改 settings 时立即失效）。
 * 非法正则在编译时丢弃，与逐次 new RegExp 时忽略的行为一致。
 */
const machineOpenPatterns = new TtlCache<RegExp[]>(30_000);

export function getMachineOpenPatterns(db: Db): Promise<RegExp[]> {
  return machineOpenPatterns.get("patterns", async () => {
    const compiled: RegExp[] = [];
    for (const pattern of (await getSettings(db)).machine_open_ua_patterns) {
      try { compiled.push(new RegExp(pattern, "i")); } catch { /* 非法正则忽略 */ }
    }
    return compiled;
  });
}
