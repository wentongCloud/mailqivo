/**
 * ASSET_DIR 文件访问（§2.1）。所有路径都由服务端生成的 storage_key（`<uuid>.<ext>`）拼出，
 * 绝不使用用户输入；读取时拒绝符号链接与目录逃逸。
 */
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { ServerRole } from "@mailqivo/shared";
import type { Config } from "../../config.ts";
import { REPO_ROOT } from "../../env.ts";

export class AssetDirError extends Error {
  readonly dir: string;
  constructor(dir: string, reason: string) {
    super(`ASSET_DIR 不可用（${dir}）：${reason}`);
    this.name = "AssetDirError";
    this.dir = dir;
  }
}

export const STORAGE_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z]{2,4}$/;

export function assetRoot(config: Pick<Config, "ASSET_DIR">): string {
  // 相对路径相对仓库根目录解析（与 .env 一致），不依赖进程 cwd。
  return path.resolve(REPO_ROOT, config.ASSET_DIR);
}

/** storage_key → 绝对路径；格式不符或逃出 ASSET_DIR 时抛错。 */
export function assetFilePath(config: Pick<Config, "ASSET_DIR">, storageKey: string): string {
  const root = assetRoot(config);
  const full = path.resolve(root, storageKey);
  if (!STORAGE_KEY_PATTERN.test(storageKey) || path.dirname(full) !== root) {
    throw new Error(`非法 storage_key：${storageKey}`);
  }
  return full;
}

/** ROLE=api / all：目录不存在则创建，并要求可读写。 */
export async function ensureAssetDir(config: Pick<Config, "ASSET_DIR">): Promise<void> {
  const root = assetRoot(config);
  try {
    await fs.mkdir(root, { recursive: true });
    await fs.access(root, fs.constants.R_OK | fs.constants.W_OK);
  } catch (err) {
    throw new AssetDirError(root, err instanceof Error ? err.message : String(err));
  }
}

/** ROLE=worker：只要求已存在且可读，不创建（目录应由 api 角色创建并挂载）。 */
export function assertAssetDirReadable(config: Pick<Config, "ASSET_DIR">): void {
  const root = assetRoot(config);
  try {
    if (!fsSync.statSync(root).isDirectory()) throw new Error("不是目录");
    fsSync.accessSync(root, fsSync.constants.R_OK | fsSync.constants.X_OK);
  } catch (err) {
    throw new AssetDirError(root, err instanceof Error ? err.message : String(err));
  }
}

/** 进程启动时调用：api / all 先创建目录；worker / all 再检查可读。 */
export async function prepareAssetDir(config: Pick<Config, "ASSET_DIR" | "ROLE">): Promise<void> {
  const role: ServerRole = config.ROLE;
  if (role === "api" || role === "all") await ensureAssetDir(config);
  if (role === "worker" || role === "all") assertAssetDirReadable(config);
}
