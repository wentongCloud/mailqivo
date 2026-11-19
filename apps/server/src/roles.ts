/**
 * §2.1 ROLE=all|api|worker：只有 all / worker 启动发送 worker、AI worker 与 scheduler（领取并发送队列）。
 */
import type { ServerRole } from "@mailqivo/shared";
import type { Config } from "./config.ts";
import type { Db } from "./db/client.ts";
import { assertAssetDirReadable } from "./modules/assets/storage.ts";
import { startAiWorker, type AiWorkerOptions } from "./worker/ai-worker.ts";
import { startScheduler } from "./worker/scheduler.ts";
import { startSendWorker, type SendWorkerOptions } from "./worker/send-worker.ts";

export type BackgroundHandle = { stop(): Promise<void> };

export type BackgroundDeps = {
  startSendWorker?: (db: Db, config: Config, options?: SendWorkerOptions) => BackgroundHandle;
  startScheduler?: (db: Db, config: Config) => BackgroundHandle;
  startAiWorker?: (db: Db, config: Config, options?: AiWorkerOptions) => BackgroundHandle;
  aiWorkerOptions?: AiWorkerOptions;
  sendWorkerOptions?: SendWorkerOptions;
};

export function runsBackgroundWorkers(role: ServerRole): boolean {
  return role === "all" || role === "worker";
}

export function runsApi(role: ServerRole): boolean {
  return role === "all" || role === "api";
}

/**
 * ROLE=api 时返回 null，不启动任何会领取 message 的组件。
 * V1.1：worker 启动前要求 ASSET_DIR 可读，否则抛 AssetDirError（拒绝启动）。
 */
export function startBackgroundServices(config: Config, db: Db, deps: BackgroundDeps = {}): BackgroundHandle | null {
  if (!runsBackgroundWorkers(config.ROLE)) return null;
  assertAssetDirReadable(config);
  const worker = (deps.startSendWorker ?? startSendWorker)(db, config, deps.sendWorkerOptions);
  const aiWorker = (deps.startAiWorker ?? startAiWorker)(db, config, deps.aiWorkerOptions);
  const scheduler = (deps.startScheduler ?? startScheduler)(db, config);
  return { async stop() { await Promise.all([worker.stop(), aiWorker.stop(), scheduler.stop()]); } };
}
