/**
 * 更新程序（实现规格「版本更新」）：launchd 任务 com.mailqivo.updater 运行任务目录中的本文件副本：
 *   node <运行目录>/.service/updates/<任务 id>/updater.mjs <任务 id>
 * 它是唯一写运行目录、安装清单与插件缓存的主人。只依赖 Node 内置模块与同目录的 lib.mjs。
 * 顺序：停服务、备份数据库、全量替换程序、启动并健康检查、迁移、核对数据。
 * 替换或启动失败则整份再替换一次。迁移失败只重试迁移。不恢复备份，不回退旧版本。
 */
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { promisify } from "node:util";
import {
  DEFAULT_CHECKS, INSTALLED_MANIFEST, LABELS, PLUGIN_DIR, PLUGIN_ID, PORTS,
  analyzeMigrations, appVersion, compareVersions, computeCheck, databasePort, findCodex, isProtected, isTaskId, killTree,
  pluginCacheMatches, pluginStatus, readEnvFile, readJournal, readJson,
  readTaskStatus, releaseCurrentTask, runCodex, safeRel, sha256File, taskDir, writeJsonAtomic
} from "./lib.mjs";

const execFileAsync = promisify(execFile);
const id = process.argv[2];
if (!isTaskId(id)) { console.error("任务 id 无效"); process.exit(2); }
const runDir = path.resolve(import.meta.dirname, "../../..");
const dir = taskDir(runDir, id);
const request = readJson(path.join(dir, "request.json"));
const status = readTaskStatus(runDir, id);
const pnpm = process.env.MAILQIVO_PNPM_BIN || "pnpm";
const RETRY_PAUSE_MS = 5_000;
const domain = `gui/${process.getuid()}`;
const launchAgents = path.join(process.env.HOME, "Library/LaunchAgents");

class StageFailure extends Error {}

function save() { writeJsonAtomic(path.join(dir, "status.json"), status); }
function log(message) { console.log(`[updater ${new Date().toISOString()}] ${message}`); }

/** 同一阶段只保留最后一条。 */
function recordStage(entry) {
  const index = status.stages.findIndex((item) => item.name === entry.name);
  if (index >= 0) status.stages[index] = entry;
  else status.stages.push(entry);
}

/** 执行一个阶段：记录开始、结果与失败原因（不含密码与令牌）。 */
async function stage(name, enabled, fn) {
  if (!enabled) { recordStage({ name, result: "skipped" }); save(); return; }
  status.stage = name; save(); log(`开始 ${name}`);
  try {
    const detail = await fn();
    recordStage({ name, result: "ok", ...(detail ? { detail } : {}) });
    save();
    return detail;
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
    recordStage({ name, result: "failed", detail: message });
    status.error = `${name}: ${message}`;
    save(); log(`失败 ${name}：${message}`);
    throw new StageFailure(message);
  }
}

async function sh(command, args, cwd = runDir, timeout = 20 * 60_000) {
  return new Promise((resolve, reject) => {
    // 独立进程组：超时时连同 pnpm 启动的 next build、tsc 等一起结束，避免回滚开始后仍写运行目录。
    const child = spawn(command, args, { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"], detached: true });
    let tail = "";
    const keep = (chunk) => { process.stdout.write(chunk); tail = (tail + chunk).slice(-4000); };
    child.stdout.on("data", keep); child.stderr.on("data", keep);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, timeout);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(tail);
      else reject(new Error(`${command} ${args.join(" ")} ${timedOut ? `超过 ${Math.round(timeout / 1000)} 秒被结束` : `退出码 ${code}`}：${tail.slice(-600)}`));
    });
  });
}

// ---------------------------------------------------------------------------
// launchd 服务
// ---------------------------------------------------------------------------

const loaded = (label) => execFileAsync("/bin/launchctl", ["print", `${domain}/${label}`]).then(() => true, () => false);
async function stopService(label) { if (await loaded(label)) await execFileAsync("/bin/launchctl", ["bootout", `${domain}/${label}`]); }
async function startService(label) {
  if (!await loaded(label)) await execFileAsync("/bin/launchctl", ["bootstrap", domain, path.join(launchAgents, `${label}.plist`)]);
  await execFileAsync("/bin/launchctl", ["kickstart", "-k", `${domain}/${label}`]);
}
const portOpen = (port) => new Promise((resolve) => {
  const socket = net.connect({ host: "127.0.0.1", port });
  socket.once("connect", () => { socket.destroy(); resolve(true); });
  socket.once("error", () => resolve(false));
});
async function waitFor(check, seconds, what) {
  for (let i = 0; i < seconds; i++) { if (await check()) return; await new Promise((r) => setTimeout(r, 1000)); }
  throw new Error(`${what} 在 ${seconds} 秒内未就绪`);
}
async function stopAppServices() {
  await stopService(LABELS.web); await stopService(LABELS.server);
  await waitFor(async () => !await portOpen(PORTS.web) && !await portOpen(PORTS.server), 60, "web、server 停止");
}
async function stopDatabase() {
  await stopService(LABELS.postgres);
  await waitFor(async () => !await portOpen(databasePort(runDir)), 60, "数据库停止");
}
async function startDatabase() {
  if (await portOpen(databasePort(runDir))) return; // 未停止过的数据库不重启
  await startService(LABELS.postgres);
  await waitFor(() => portOpen(databasePort(runDir)), 60, "数据库");
}
/** 失败后尽力启动数据库与服务；返回写入错误信息的结果说明。 */
async function restartAfterFailure() {
  try {
    await startDatabase();
    await startAppServices();
    return "服务已重新启动";
  } catch (error) {
    return `服务未能重新启动：${error instanceof Error ? error.message : String(error)}`;
  }
}
async function httpStatus(url, init) {
  try { return (await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(5000), ...init })).status; } catch { return 0; }
}
/** 就绪：API 健康检查的 version 等于候选版本，且登录页返回 200。 */
async function candidateReady() {
  try {
    const response = await fetch(`http://127.0.0.1:${PORTS.server}/healthz`, { signal: AbortSignal.timeout(5000) });
    if (response.status !== 200) return false;
    const health = await response.json();
    if (health.version !== status.app.target) return false;
  } catch { return false; }
  return await httpStatus(`http://127.0.0.1:${PORTS.web}/login`) === 200;
}
async function startAppServices() {
  await startService(LABELS.server); await startService(LABELS.web);
  await waitFor(candidateReady, 120, "web、server");
}

// ---------------------------------------------------------------------------
// 数据库读取（运行目录 node_modules 中的 pg，在替换文件之前加载）
// ---------------------------------------------------------------------------

async function databaseState() {
  const pg = createRequire(path.join(runDir, "apps/server/package.json"))("pg");
  const client = new pg.Client({ connectionString: readEnvFile(runDir).DATABASE_URL });
  await client.connect();
  try {
    const migrations = await client.query("SELECT created_at FROM drizzle.__drizzle_migrations").catch(() => ({ rows: [] }));
    const campaigns = await client.query("SELECT count(*) FILTER (WHERE status = 'preparing')::int AS preparing, count(*) FILTER (WHERE status = 'sending')::int AS sending FROM campaigns");
    return { recordedCreatedAt: migrations.rows.map((row) => Number(row.created_at)), ...campaigns.rows[0] };
  } finally {
    await client.end();
  }
}

/** 备份前的业务行数。软删活动只在迁移 0012 中删除，联系人和模板应保持不变。 */
async function tableCounts() {
  const pg = createRequire(path.join(runDir, "apps/server/package.json"))("pg");
  const client = new pg.Client({ connectionString: readEnvFile(runDir).DATABASE_URL });
  await client.connect();
  try {
    const deleted = await client.query("SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'campaigns' AND column_name = 'deleted_at'");
    const counts = await client.query("SELECT (SELECT count(*)::int FROM contacts) AS contacts, (SELECT count(*)::int FROM templates) AS templates, (SELECT count(*)::int FROM campaigns) AS campaigns");
    const softDeleted = deleted.rowCount
      ? (await client.query("SELECT count(*)::int AS n FROM campaigns WHERE deleted_at IS NOT NULL")).rows[0].n
      : 0;
    const row = counts.rows[0];
    return { contacts: Number(row.contacts), templates: Number(row.templates), campaigns: Number(row.campaigns), softDeleted: Number(softDeleted) };
  } finally {
    await client.end();
  }
}

// ---------------------------------------------------------------------------
// 备份数据库，再全量替换程序。失败不修补个别文件，整份再复制一次。不恢复备份。
// ---------------------------------------------------------------------------

function copyFile(from, to) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); }

/** 停库后把 .pgdata 复制到任务目录。配置、data/ 与 .env 不在替换范围内，不另做副本。 */
async function backupData() {
  const dest = path.join(dir, "pgdata");
  const countsFile = path.join(dir, "counts.json");
  if (!fs.existsSync(path.join(dest, "PG_VERSION"))) {
    if (!fs.existsSync(path.join(runDir, ".pgdata", "PG_VERSION"))) throw new Error("没有本地数据库目录 .pgdata");
    const partial = `${dest}.partial`;
    await stopDatabase();
    try {
      fs.rmSync(partial, { recursive: true, force: true });
      fs.cpSync(path.join(runDir, ".pgdata"), partial, { recursive: true });
      fs.rmSync(dest, { recursive: true, force: true });
      fs.renameSync(partial, dest);
    } finally {
      await startDatabase();
    }
  }
  if (!fs.existsSync(countsFile)) writeJsonAtomic(countsFile, await tableCounts());
  return "已备份数据库";
}

/** 按候选清单覆盖运行目录中的程序文件。不碰 .env、data/、.pgdata、.service。 */
function fullReplace(plan) {
  for (const [rel, hash] of Object.entries(plan.manifest)) {
    if (isProtected(rel)) continue;
    const target = path.join(runDir, safeRel(rel));
    copyFile(path.join(request.source_dir, rel), target);
    if (sha256File(target) !== hash) throw new Error(`复制后内容不一致：${rel}`);
  }
  for (const rel of plan.files.removed) {
    if (!isProtected(rel)) fs.rmSync(path.join(runDir, safeRel(rel)), { force: true });
  }
  return "已全量替换";
}


// ---------------------------------------------------------------------------
// 候选验收与运行验收
// ---------------------------------------------------------------------------

/** D7：候选根目录 release.json 的 checks（相对 apps/server 的 .ts 脚本）；未声明时运行默认检查。 */
async function verifyCandidate() {
  let checks = DEFAULT_CHECKS;
  const release = path.join(request.source_dir, "release.json");
  if (fs.existsSync(release)) checks = readJson(release).checks ?? DEFAULT_CHECKS;
  for (const script of checks) {
    if (!/^scripts\/[\w./-]+\.ts$/.test(script) || script.includes("..")) throw new Error(`release.json 中的检查路径无效：${script}`);
    await sh(pnpm, ["--filter", "@mailqivo/server", "exec", "tsx", script], request.source_dir);
  }
  return checks.join("、");
}

/** 迁移完成后核对：迁移记录完整，且联系人、模板、未软删活动不少于备份前。 */
async function checkData(plan) {
  const before = readJson(path.join(dir, "counts.json"));
  const after = await tableCounts();
  const journal = analyzeMigrations(readJournal(runDir), (await databaseState()).recordedCreatedAt);
  if (journal.pending.length || journal.skipped.length || journal.databaseAhead) {
    throw new Error(`迁移未完整执行${journal.pending.length ? `：${journal.pending.join("、")}` : ""}`);
  }
  const dropsSoftDeleted = plan.migrations.some((tag) => tag.includes("campaign_physical_delete"));
  const expectedCampaigns = dropsSoftDeleted ? before.campaigns - before.softDeleted : before.campaigns;
  if (after.contacts < before.contacts || after.templates < before.templates || after.campaigns < expectedCampaigns) {
    throw new Error(`数据少于备份前：联系人 ${before.contacts}→${after.contacts}，活动 ${expectedCampaigns}→${after.campaigns}，模板 ${before.templates}→${after.templates}`);
  }
  return `联系人 ${after.contacts}，活动 ${after.campaigns}，模板 ${after.templates}`;
}

async function updatePlugin(target) {
  const codex = findCodex();
  if (!codex) throw new Error("找不到 Codex CLI");
  await runCodex(codex, ["plugin", "add", PLUGIN_ID, "--json"], 300_000);
  const plugin = await pluginStatus(codex);
  status.plugin.now = plugin.installed; status.plugin.enabled = plugin.enabled; save();
  if (plugin.installed !== target || !plugin.enabled) throw new Error(`Codex 显示插件 ${plugin.installed ?? "未安装"}${plugin.enabled ? "" : "（未启用）"}`);
  if (!pluginCacheMatches(path.join(runDir, PLUGIN_DIR), target)) throw new Error("插件缓存与运行目录的插件文件不一致");
  return `插件 ${target} 已安装并启用；请完全退出并重新打开 Codex`;
}

// ---------------------------------------------------------------------------
// 模式
// ---------------------------------------------------------------------------

async function lockAndRecheck() {
  const { check, plan } = await computeCheck({ runDir, sourceDir: request.source_dir, database: await databaseState() });
  const blockers = check.blockers.filter((blocker) => !(blocker.code === "TASK_RUNNING" && blocker.items?.[0] === id));
  if (blockers.length) throw new Error(`阻止条件：${blockers.map((blocker) => blocker.code).join("、")}`);
  if (!plan || plan.manifestSha256 !== request.manifest_sha256) throw new Error("候选在确认后发生变化，请重新检查并确认");
  return plan;
}

/** 非致命步骤：失败写入 warnings，阶段仍记为完成。 */
async function note(name, fn) {
  try {
    const detail = await fn();
    recordStage({ name, result: "ok", ...(detail ? { detail } : {}) });
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
    status.warnings.push(message);
    recordStage({ name, result: "ok", detail: message });
    log(`已记录 ${name}：${message}`);
  }
  save();
}

async function installDeps() {
  await sh(pnpm, ["install", "--frozen-lockfile"]);
  return "已按锁文件安装";
}

async function buildApp() {
  await sh(pnpm, ["--filter", "@mailqivo/server", "typecheck"]);
  await sh(pnpm, ["--filter", "@mailqivo/web", "exec", "next", "build", "--webpack"]);
}

async function migrate(plan) {
  await startDatabase();
  if (!plan.migrations.length) return "无待执行迁移";
  await sh(pnpm, ["db:migrate"]);
  return plan.migrations.join("、");
}

async function pluginStep(plan) {
  if (!plan.pluginUpdate) return "插件无版本变化";
  if (status.plugin.before && status.plugin.target && compareVersions(status.plugin.target, status.plugin.before) < 0) {
    throw new Error("插件版本低于已安装版本，保持已安装插件");
  }
  return updatePlugin(status.plugin.target);
}

function markInstalled(plan) {
  status.app.now = appVersion(runDir);
  status.error = null;
  writeJsonAtomic(path.join(runDir, INSTALLED_MANIFEST), {
    version: status.app.target, commit: plan.commit, installed_at: new Date().toISOString(), files: plan.manifest
  });
  save();
}

/** 全量替换、安装、构建、启动。任一步失败就停掉服务，从头再替换一次。 */
async function replaceUntilHealthy(plan, stoppedAt) {
  for (;;) {
    try {
      await stopAppServices();
      await stage("apply_files", true, () => fullReplace(plan));
      await stage("install", true, installDeps);
      await stage("build", true, buildApp);
      await stage("start_services", true, async () => {
        await startDatabase();
        await startAppServices();
        if (stoppedAt != null && status.downtime_sec == null) status.downtime_sec = Math.round((Date.now() - stoppedAt) / 1000);
        return "健康检查通过";
      });
      markInstalled(plan);
      return;
    } catch (error) {
      log(`全量替换后重试：${error instanceof Error ? error.message : String(error)}`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_PAUSE_MS));
    }
  }
}

/** 迁移失败只重试迁移。drizzle 在一个事务里执行，失败时数据仍是迁移前的内容。 */
async function migrateUntilOk(plan) {
  for (;;) {
    try {
      await stage("migrate", true, () => migrate(plan));
      return;
    } catch (error) {
      log(`重试迁移：${error instanceof Error ? error.message : String(error)}`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_PAUSE_MS));
    }
  }
}

async function complete(plan, stoppedAt) {
  await replaceUntilHealthy(plan, stoppedAt);
  await migrateUntilOk(plan);
  await stage("verify_running", true, () => checkData(plan));
  await note("plugin", () => pluginStep(plan));
}

async function runUpdate() {
  let plan;
  await stage("lock", true, async () => { plan = await lockAndRecheck(); });
  writeJsonAtomic(path.join(dir, "plan.json"), plan);
  if (!plan.appUpdate) return;
  await stage("verify_candidate", true, verifyCandidate);
  let stoppedAt = null;
  try {
    await stage("stop_services", true, async () => { stoppedAt = Date.now(); await stopAppServices(); });
    await stage("backup", true, backupData);
  } catch (error) {
    status.error = `${status.error}；${await restartAfterFailure()}`;
    throw error;
  }
  status.forward = true;
  save();
  await complete(plan, stoppedAt);
}

status.state = "running"; status.pid = process.pid; if (!Array.isArray(status.warnings)) status.warnings = []; save();
try {
  if (request.mode !== "update") throw new Error(`未知模式：${request.mode}`);
  if (status.forward) await complete(readJson(path.join(dir, "plan.json")), null);
  else await runUpdate();
  status.state = "succeeded";
} catch (error) {
  if (status.state === "running") status.state = "failed";
  if (!status.error) status.error = error instanceof Error ? error.message : String(error);
} finally {
  status.pid = null;
  status.app.now = appVersion(runDir);
  try { const plugin = await pluginStatus(findCodex(), 15_000); status.plugin.now = plugin.installed; status.plugin.enabled = plugin.enabled; } catch { /* 保留已有值 */ }
  status.stage = null;
  status.finished_at = new Date().toISOString();
  recordStage({ name: "finish", result: status.state === "succeeded" ? "ok" : "failed" });
  save();
  releaseCurrentTask(runDir, id);
  log(`结束：${status.state}`);
}
