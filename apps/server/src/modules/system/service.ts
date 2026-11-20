/**
 * 版本更新的 API 侧（实现规格「版本更新」）：只读检查、两步确认、创建任务并交给更新程序、读取任务状态。
 * API 不写运行目录；检查与差异计算由 update/lib.mjs 实现，执行由 update/updater.mjs（launchd 任务）完成。
 */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { sql } from "drizzle-orm";
import type { ConfirmChallenge, UpdateCheck, UpdateSummary, UpdateTaskMode, UpdateTaskStatus } from "@mailqivo/shared";
import type { Config } from "../../config.ts";
import type { Db } from "../../db/client.ts";
import { REPO_ROOT } from "../../env.ts";
import { consumeConfirmToken, issueConfirmToken } from "../../lib/confirm-token.ts";
import { Errors } from "../../lib/errors.ts";
import {
  CURRENT_TASK_FILE, LABELS, UPDATER_FILES, computeCheck, currentTask, effectiveTaskStatus, findCodex, isTaskAlive, isTaskId, pluginStatus,
  readTaskStatus, releaseCurrentTask, taskDir, taskHistory, updateSummary, writeJsonAtomic, type PluginState
} from "../../update/lib.mjs";

const execFileAsync = promisify(execFile);
type UpdateConfig = Pick<Config, "UPDATE_SOURCE_DIR">;

async function databaseState(db: Db) {
  const migrations = await db.execute<{ created_at: string }>(sql`SELECT created_at FROM drizzle.__drizzle_migrations`);
  const [campaigns] = (await db.execute<{ preparing: number; sending: number }>(sql`
    SELECT count(*) FILTER (WHERE status = 'preparing')::int AS preparing, count(*) FILTER (WHERE status = 'sending')::int AS sending FROM campaigns
  `)).rows;
  return { recordedCreatedAt: migrations.rows.map((row) => Number(row.created_at)), preparing: campaigns!.preparing, sending: campaigns!.sending };
}

// ---------------------------------------------------------------------------
// Codex 插件状态（R2）：页面请求经 Next.js rewrites 转发，最多等待 25 秒；Codex 读取本身最长 120 秒，
// 超过 25 秒时在后台继续，结果留给之后的检查（含两步确认的第二步）使用。
// ---------------------------------------------------------------------------

const PAGE_WAIT_MS = 25_000;
const CODEX_READ_MS = 120_000;
/** 读取结果的有效期；任务结束后（插件可能已变）也立即失效。 */
const PLUGIN_STATE_TTL_MS = 5 * 60_000;

type PluginRead = { startedAt: number; failed: boolean; promise: Promise<PluginState> };
let pluginRead: PluginRead | null = null;

function lastTaskFinishedAt(): number {
  const { last } = taskHistory(REPO_ROOT);
  const finished = last ? readTaskStatus(REPO_ROOT, last)?.finished_at : null;
  return finished ? Date.parse(finished) : 0;
}

function readPluginForPage(): Promise<PluginState> {
  const read = pluginRead;
  if (!read || read.failed || Date.now() - read.startedAt > PLUGIN_STATE_TTL_MS || read.startedAt < lastTaskFinishedAt()) {
    const next: PluginRead = { startedAt: Date.now(), failed: false, promise: pluginStatus(findCodex(), CODEX_READ_MS) };
    next.promise.catch(() => { next.failed = true; });
    pluginRead = next;
  }
  const { promise } = pluginRead!;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Codex CLI 仍在读取插件状态（最长 ${CODEX_READ_MS / 1000} 秒），请稍后重新检查`)), PAGE_WAIT_MS);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

async function check(db: Db, config: UpdateConfig) {
  return computeCheck({ runDir: REPO_ROOT, sourceDir: config.UPDATE_SOURCE_DIR, database: await databaseState(db), readPlugin: readPluginForPage });
}

export async function getUpdateCheck(db: Db, config: UpdateConfig): Promise<UpdateCheck> {
  return (await check(db, config)).check;
}

export async function getUpdateTask(id: string): Promise<UpdateTaskStatus> {
  const status = isTaskId(id) ? readTaskStatus(REPO_ROOT, id) : null;
  if (!status) throw Errors.notFound("更新任务不存在");
  // 换文件之后更新程序被杀掉时，页面仍能打开就从这一次任务继续，不另起一次更新。
  if (status.forward && status.state === "running" && currentTask(REPO_ROOT) === id && !isTaskAlive(status)) {
    await execFileAsync("/bin/launchctl", ["kickstart", `gui/${process.getuid!()}/${LABELS.updater}`]).catch(() => {});
  }
  return effectiveTaskStatus(status);
}

/**
 * 创建任务目录，复制更新程序，写入请求与初始状态，再启动 launchd 任务 com.mailqivo.updater。
 * 任务锁（C5）：已有未结束的任务时拒绝。检查与写入 `current` 之间没有 await，同一 API 进程内不会交错。
 */
async function startTask(mode: UpdateTaskMode, request: Record<string, unknown>, versions: Pick<UpdateTaskStatus, "app" | "plugin">): Promise<{ task_id: string }> {
  const running = currentTask(REPO_ROOT);
  if (running) throw Errors.invalidState("已有未结束的更新任务", { blockers: [{ code: "TASK_RUNNING", items: [running] }] });
  pluginRead = null;
  const id = randomUUID();
  const dir = taskDir(REPO_ROOT, id);
  fs.mkdirSync(dir, { recursive: true });
  for (const rel of UPDATER_FILES) fs.copyFileSync(path.join(REPO_ROOT, rel), path.join(dir, path.basename(rel)));
  writeJsonAtomic(path.join(dir, "request.json"), { id, mode, created_at: new Date().toISOString(), ...request });
  const status: UpdateTaskStatus = {
    id, mode, state: "queued", created_at: new Date().toISOString(), finished_at: null, stage: null, stages: [],
    ...versions, downtime_sec: null, forward: false, warnings: [], pid: null, error: null
  };
  writeJsonAtomic(path.join(dir, "status.json"), status);
  fs.writeFileSync(path.join(REPO_ROOT, CURRENT_TASK_FILE), id);
  try {
    await execFileAsync("/bin/launchctl", ["kickstart", `gui/${process.getuid!()}/${LABELS.updater}`]);
  } catch (error) {
    releaseCurrentTask(REPO_ROOT, id);
    writeJsonAtomic(path.join(dir, "status.json"), {
      ...status, state: "failed", finished_at: new Date().toISOString(),
      error: `无法启动更新程序 ${LABELS.updater}（请重新运行安装器）：${error instanceof Error ? error.message : String(error)}`
    });
  }
  return { task_id: id };
}

/** §5.2 两步确认后启动更新任务。阻止条件或已是最新时返回 INVALID_STATE。 */
export async function confirmUpdate(db: Db, config: UpdateConfig, confirmToken?: string): Promise<ConfirmChallenge<UpdateSummary> | { task_id: string }> {
  const { check: result, plan } = await check(db, config);
  if (result.blockers.length || !plan) throw Errors.invalidState("当前不能更新", { blockers: result.blockers });
  if (result.up_to_date) throw Errors.invalidState("已是最新版本");
  const summary = updateSummary(result, plan);
  const params = { action: "app_update" as const, target: { run_dir: REPO_ROOT, source_dir: config.UPDATE_SOURCE_DIR }, summary };
  if (!confirmToken) return issueConfirmToken(db, params);
  await consumeConfirmToken(db, { token: confirmToken, ...params });
  return startTask("update", { source_dir: config.UPDATE_SOURCE_DIR, manifest_sha256: plan.manifestSha256, summary }, {
    app: { before: result.app.installed, target: result.app.candidate, now: result.app.installed },
    plugin: { before: result.plugin.installed, target: result.plugin.candidate, now: result.plugin.installed, enabled: result.plugin.enabled }
  });
}
