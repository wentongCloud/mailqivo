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
  CURRENT_TASK_FILE, LABELS, UPDATER_FILES, computeCheck, isTaskId, readTaskStatus, taskDir, updateSummary, writeJsonAtomic
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

async function check(db: Db, config: UpdateConfig) {
  // 页面经 Next.js rewrites 请求本接口；Codex 等待控制在 25 秒内，超时报告 CODEX_UNAVAILABLE。
  return computeCheck({ runDir: REPO_ROOT, sourceDir: config.UPDATE_SOURCE_DIR, database: await databaseState(db), codexTimeoutMs: 25_000 });
}

export async function getUpdateCheck(db: Db, config: UpdateConfig): Promise<UpdateCheck> {
  return (await check(db, config)).check;
}

export function getUpdateTask(id: string): UpdateTaskStatus {
  const status = isTaskId(id) ? readTaskStatus(REPO_ROOT, id) : null;
  if (!status) throw Errors.notFound("更新任务不存在");
  return status;
}

/** 创建任务目录，复制更新程序，写入请求与初始状态，再启动 launchd 任务 com.mailqivo.updater。 */
async function startTask(mode: UpdateTaskMode, request: Record<string, unknown>, versions: Pick<UpdateTaskStatus, "app" | "plugin">): Promise<{ task_id: string }> {
  const id = randomUUID();
  const dir = taskDir(REPO_ROOT, id);
  fs.mkdirSync(dir, { recursive: true });
  for (const rel of UPDATER_FILES) fs.copyFileSync(path.join(REPO_ROOT, rel), path.join(dir, path.basename(rel)));
  writeJsonAtomic(path.join(dir, "request.json"), { id, mode, created_at: new Date().toISOString(), ...request });
  const status: UpdateTaskStatus = {
    id, mode, state: "queued", created_at: new Date().toISOString(), finished_at: null, stage: null, stages: [],
    ...versions, downtime_sec: null, backup_dir: null, database_backed_up: false, error: null
  };
  writeJsonAtomic(path.join(dir, "status.json"), status);
  fs.writeFileSync(path.join(REPO_ROOT, CURRENT_TASK_FILE), id);
  try {
    await execFileAsync("/bin/launchctl", ["kickstart", `gui/${process.getuid!()}/${LABELS.updater}`]);
  } catch (error) {
    fs.rmSync(path.join(REPO_ROOT, CURRENT_TASK_FILE), { force: true });
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

/** 部分完成且只有插件阶段失败的任务：重试插件（用户已确认过同一目标）。 */
export async function retryPlugin(id: string): Promise<{ task_id: string }> {
  const task = getUpdateTask(id);
  const pluginFailed = task.stages.some((stage) => stage.name === "plugin" && stage.result === "failed");
  if (task.state !== "partial" || !pluginFailed) throw Errors.invalidState("只有插件阶段失败的任务可以重试插件");
  if (task.app.now !== task.app.target) throw Errors.invalidState("应用未更新到目标版本，不能单独重试插件");
  return startTask("plugin", {}, { app: { ...task.app }, plugin: { before: task.plugin.now, target: task.plugin.target, now: task.plugin.now, enabled: task.plugin.enabled } });
}

/** D5：手动回滚部分完成的任务。恢复数据库须在摘要中明确选择，并经两步确认。 */
export async function rollbackTask(db: Db, id: string, input: { restore_database: boolean; confirm_token?: string }) {
  const task = getUpdateTask(id);
  if (task.state !== "partial" || !task.backup_dir) throw Errors.invalidState("只有部分完成且有备份的任务可以回滚");
  if (input.restore_database && !task.database_backed_up) throw Errors.invalidState("该任务没有数据库备份");
  const summary = {
    task_id: id,
    app: { now: task.app.now, restore_to: task.app.before },
    restore_database: input.restore_database,
    /** 恢复数据库会丢弃更新后写入的数据，并可能让已发出的邮件重新进入队列。 */
    may_resend: input.restore_database
  };
  const params = { action: "app_update_rollback" as const, target: { task_id: id }, summary };
  if (!input.confirm_token) return issueConfirmToken(db, params);
  await consumeConfirmToken(db, { token: input.confirm_token, ...params });
  return startTask("rollback", { rollback_of: id, restore_database: input.restore_database }, {
    app: { before: task.app.now, target: task.app.before, now: task.app.now },
    plugin: { ...task.plugin }
  });
}
