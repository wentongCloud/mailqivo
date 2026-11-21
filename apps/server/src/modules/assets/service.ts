import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { desc, eq, inArray, sql } from "drizzle-orm";
import type { AssetDto, AttachmentSnapshotItem } from "@mailqivo/shared";
import type { Config } from "../../config.ts";
import type { Db } from "../../db/client.ts";
import { assets } from "../../db/schema.ts";
import { AppError, Errors } from "../../lib/errors.ts";
import { toPage, type PageParams } from "../../lib/pagination.ts";
import { getAttachmentMaxTotalMb } from "../settings/service.ts";
import { sniffAsset } from "./sniff.ts";
import { assetFilePath, ensureAssetDir } from "./storage.ts";

type AssetRow = typeof assets.$inferSelect;
type StorageConfig = Pick<Config, "ASSET_DIR">;

export function toAssetDto(row: AssetRow): AssetDto {
  return {
    id: row.id,
    filename: row.filename,
    mime_type: row.mime_type,
    size_bytes: row.size_bytes,
    sha256: row.sha256,
    enabled: row.enabled,
    created_at: row.created_at.toISOString()
  };
}

/** §3 / §10.1：base64 编码后大小 ≈ ceil(n/3)*4。 */
export function encodedSize(rawBytes: number): number {
  return Math.ceil(rawBytes / 3) * 4;
}

/** 编码后不超过 maxMb 的最大原始字节数。 */
export function maxRawBytesForMb(maxMb: number): number {
  return Math.floor((maxMb * 1024 * 1024) / 4) * 3;
}

const FILENAME_MAX = 200;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** 文件名只用于展示与 MIME；含路径分隔符 / 控制字符 / "." ".." 一律拒绝（路径穿越）。 */
export function validateFilename(filename: string): string {
  const name = filename.normalize("NFC");
  if (!name.trim() || name === "." || name === "..") throw Errors.validation("文件名不合法", { reason: "FILENAME_INVALID" });
  if (/[\\/]/.test(name) || CONTROL_CHARS.test(name) || name.includes("..")) {
    throw Errors.validation("文件名不得包含路径分隔符、“..”或控制字符", { reason: "FILENAME_PATH" });
  }
  if ([...name].length > FILENAME_MAX) throw Errors.validation(`文件名不能超过 ${FILENAME_MAX} 个字符`, { reason: "FILENAME_TOO_LONG" });
  return name;
}

const REJECT_MESSAGE = {
  EMPTY: "不能上传空文件",
  EXTENSION_NOT_ALLOWED: "不支持该文件类型，仅允许 pdf / docx / xlsx / pptx / csv / txt / png / jpg / jpeg",
  CONTENT_NOT_ALLOWED: "文件内容类型不在允许范围内（压缩包、旧版 doc / xls / ppt、可执行文件等均不支持）",
  CONTENT_MISMATCH: "文件内容与扩展名不符"
} as const;

export async function createAsset(
  db: Db,
  config: StorageConfig,
  input: { filename: string; buffer: Buffer }
): Promise<AssetDto> {
  const filename = validateFilename(input.filename);
  const { buffer } = input;
  const maxMb = await getAttachmentMaxTotalMb(db);
  if (encodedSize(buffer.length) > maxMb * 1024 * 1024) {
    throw Errors.validation(`文件编码后超过 ${maxMb} MB 上限`, { reason: "TOO_LARGE", max_total_mb: maxMb });
  }
  const sniffed = await sniffAsset(filename, buffer);
  if (!sniffed.ok) throw Errors.validation(REJECT_MESSAGE[sniffed.reason], { reason: sniffed.reason, detected: sniffed.detected });

  const id = randomUUID();
  const storage_key = `${id}.${sniffed.ext}`;
  await ensureAssetDir(config);
  const filePath = assetFilePath(config, storage_key);
  await fs.writeFile(filePath, buffer, { flag: "wx", mode: 0o640 });
  try {
    const [row] = await db
      .insert(assets)
      .values({
        id,
        filename,
        storage_key,
        mime_type: sniffed.mime,
        size_bytes: buffer.length,
        sha256: createHash("sha256").update(buffer).digest("hex")
      })
      .returning();
    return toAssetDto(row!);
  } catch (err) {
    await fs.rm(filePath, { force: true });
    throw err;
  }
}

const assetOrder = [desc(assets.created_at), desc(assets.id)] as const;
const assetWhere = (filter: { enabled?: boolean }) => (filter.enabled === undefined ? undefined : eq(assets.enabled, filter.enabled));

/**
 * 列出附件资产：按 enabled 筛选，按（created_at, id）倒序。传入 page 时在数据库端分页，
 * total 用同一筛选条件计数；不传时返回全部（REST 列表）。
 */
export async function listAssets(db: Db, filter: { enabled?: boolean } = {}, page?: PageParams) {
  const where = assetWhere(filter);
  const query = db.select().from(assets).where(where).orderBy(...assetOrder);
  if (!page) {
    const rows = await query;
    return toPage(rows.map(toAssetDto), rows.length, { page: 1, page_size: rows.length });
  }
  const [rows, [counted]] = await Promise.all([
    query.limit(page.limit).offset(page.offset),
    db.select({ total: sql<number>`count(*)::int` }).from(assets).where(where)
  ]);
  return toPage(rows.map(toAssetDto), counted?.total ?? 0, page);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getAsset(db: Db, id: string): Promise<AssetDto> {
  const row = UUID_RE.test(id) ? (await db.select().from(assets).where(eq(assets.id, id)))[0] : undefined;
  if (!row) throw Errors.notFound("附件资产不存在");
  return toAssetDto(row);
}

/** 停用只阻止新引用；幂等。 */
export async function disableAsset(db: Db, id: string): Promise<AssetDto> {
  if (!UUID_RE.test(id)) throw Errors.notFound("附件资产不存在");
  const [row] = await db.update(assets).set({ enabled: false }).where(eq(assets.id, id)).returning();
  if (!row) throw Errors.notFound("附件资产不存在");
  return toAssetDto(row);
}

// ---------------------------------------------------------------------------
// 供 worker / campaigns / MCP 复用的读取与校验
// ---------------------------------------------------------------------------

export type AssetUnavailableReason = "RECORD_MISSING" | "FILE_MISSING" | "FILE_UNREADABLE" | "SHA_MISMATCH";

/** 附件文件缺失 / 不可读 / sha256 不符（不区分是否 enabled）。worker 据此 skipped(ATTACHMENT_UNAVAILABLE)。 */
export class AssetUnavailableError extends Error {
  readonly asset_id: string;
  readonly reason: AssetUnavailableReason;
  constructor(asset_id: string, reason: AssetUnavailableReason, detail?: string) {
    super(`附件不可用（${asset_id}）：${reason}${detail ? ` ${detail}` : ""}`);
    this.name = "AssetUnavailableError";
    this.asset_id = asset_id;
    this.reason = reason;
  }
}

async function readVerifiedFile(
  config: StorageConfig,
  asset_id: string,
  storage_key: string,
  expected: { sha256: string; size_bytes?: number }
): Promise<Buffer> {
  const filePath = assetFilePath(config, storage_key);
  let buffer: Buffer;
  try {
    // 拒绝符号链接与非常规文件：O_NOFOLLOW 打开并 fstat。
    const handle = await fs.open(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new AssetUnavailableError(asset_id, "FILE_UNREADABLE", "不是常规文件");
      buffer = await handle.readFile();
    } finally {
      await handle.close();
    }
  } catch (err) {
    if (err instanceof AssetUnavailableError) throw err;
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new AssetUnavailableError(asset_id, "FILE_MISSING");
    throw new AssetUnavailableError(asset_id, "FILE_UNREADABLE", code);
  }
  const sha = createHash("sha256").update(buffer).digest("hex");
  if (sha !== expected.sha256.toLowerCase() || (expected.size_bytes !== undefined && buffer.length !== expected.size_bytes)) {
    throw new AssetUnavailableError(asset_id, "SHA_MISMATCH");
  }
  return buffer;
}

/**
 * §6.3 worker 发送前读取：按 attachment_snapshot 的一项读取文件并校验 sha256（及大小）。
 * **不检查 enabled**（停用只阻止新引用）。失败抛 AssetUnavailableError。
 */
export async function readAssetVerified(
  db: Db,
  config: StorageConfig,
  item: Pick<AttachmentSnapshotItem, "asset_id" | "sha256"> & Partial<Pick<AttachmentSnapshotItem, "size_bytes">>
): Promise<Buffer> {
  const row = UUID_RE.test(item.asset_id) ? (await db.select().from(assets).where(eq(assets.id, item.asset_id)))[0] : undefined;
  if (!row) throw new AssetUnavailableError(item.asset_id, "RECORD_MISSING");
  return readVerifiedFile(config, row.id, row.storage_key, { sha256: item.sha256, size_bytes: item.size_bytes });
}

export type AssetUsabilityProblem = "NOT_FOUND" | "DISABLED" | "FILE_MISSING" | "FILE_UNREADABLE" | "SHA_MISMATCH";

/**
 * 新引用检查（规则保存、预览、send 第一步）：资产存在、enabled、文件可读且 sha256 与库中一致。
 * 全部可用时按入参顺序返回元数据；否则抛 VALIDATION，details.assets 列出每个问题资产。
 */
export async function assertAssetsUsable(db: Db, config: StorageConfig, ids: string[]): Promise<AssetDto[]> {
  const validIds = [...new Set(ids.filter((id) => UUID_RE.test(id)))];
  const rows = validIds.length ? await db.select().from(assets).where(inArray(assets.id, validIds)) : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  // 有记录时一并返回 filename，供调用方展示问题附件；找不到记录时为 null。
  const problems: { asset_id: string; filename: string | null; problem: AssetUsabilityProblem }[] = [];
  const result: AssetDto[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) { problems.push({ asset_id: id, filename: null, problem: "NOT_FOUND" }); continue; }
    if (!row.enabled) { problems.push({ asset_id: id, filename: row.filename, problem: "DISABLED" }); continue; }
    try {
      await readVerifiedFile(config, row.id, row.storage_key, { sha256: row.sha256, size_bytes: row.size_bytes });
      result.push(toAssetDto(row));
    } catch (err) {
      if (!(err instanceof AssetUnavailableError)) throw err;
      problems.push({ asset_id: id, filename: row.filename, problem: err.reason === "RECORD_MISSING" ? "NOT_FOUND" : err.reason });
    }
  }
  if (problems.length) throw new AppError("VALIDATION", "存在不可用的附件资产", { assets: problems });
  return result;
}
