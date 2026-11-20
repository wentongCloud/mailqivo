/**
 * 更新程序（实现规格「版本更新」）：launchd 任务 com.mailqivo.updater 运行任务目录中的本文件副本：
 *   node <运行目录>/.service/updates/<任务 id>/updater.mjs <任务 id>
 * 它是唯一写运行目录、安装清单与插件缓存的主人。只依赖 Node 内置模块与同目录的 lib.mjs。
 */
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { promisify } from "node:util";
import {
  DEFAULT_CHECKS, INSTALLED_MANIFEST, LABELS, PLUGIN_DIR, PLUGIN_ID, PORTS,
  appVersion, computeCheck, findCodex, isTaskId, pluginCacheMatches, pluginStatus, readEnvFile, readJson,
  readTaskStatus, releaseCurrentTask, runCodex, safeRel, sha256File, taskDir, writeJsonAtomic
} from "./lib.mjs";

const execFileAsync = promisify(execFile);
const id = process.argv[2];
if (!isTaskId(id)) { console.error("任务 id 无效"); process.exit(2); }
const runDir = path.resolve(import.meta.dirname, "../../..");
const dir = taskDir(runDir, id);
const request = readJson(path.join(dir, "request.json"));
const status = readTaskStatus(runDir, id);
const backupDir = path.join(dir, "backup");
const pnpm = process.env.MAILQIVO_PNPM_BIN || "pnpm";
const domain = `gui/${process.getuid()}`;
const launchAgents = path.join(process.env.HOME, "Library/LaunchAgents");

class StageFailure extends Error {}

function save() { writeJsonAtomic(path.join(dir, "status.json"), status); }
function log(message) { console.log(`[updater ${new Date().toISOString()}] ${message}`); }

/** 执行一个阶段：记录开始、结果与失败原因（不含密码与令牌）。 */
async function stage(name, enabled, fn) {
  if (!enabled) { status.stages.push({ name, result: "skipped" }); save(); return; }
  status.stage = name; save(); log(`开始 ${name}`);
  try {
    const detail = await fn();
    status.stages.push({ name, result: "ok", ...(detail ? { detail } : {}) });
    save();
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
    status.stages.push({ name, result: "failed", detail: message });
    status.error = `${name}: ${message}`;
    save(); log(`失败 ${name}：${message}`);
    throw new StageFailure(message);
  }
}

async function sh(command, args, cwd = runDir, timeout = 20 * 60_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let tail = "";
    const keep = (chunk) => { process.stdout.write(chunk); tail = (tail + chunk).slice(-4000); };
    child.stdout.on("data", keep); child.stderr.on("data", keep);
    const timer = setTimeout(() => child.kill("SIGTERM"), timeout);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(tail);
      else reject(new Error(`${command} ${args.join(" ")} 退出码 ${code}：${tail.slice(-600)}`));
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
  await waitFor(async () => !await portOpen(PORTS.postgres) && !fs.existsSync(path.join(runDir, ".pgdata/postmaster.pid")), 60, "数据库停止");
}
async function startDatabase() {
  if (await portOpen(PORTS.postgres)) return; // 未停止过的数据库不重启
  await startService(LABELS.postgres);
  await waitFor(() => portOpen(PORTS.postgres), 60, "数据库");
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
async function startAppServices() {
  await startService(LABELS.server); await startService(LABELS.web);
  await waitFor(async () => await httpStatus(`http://127.0.0.1:${PORTS.server}/healthz`) === 200 &&
    await httpStatus(`http://127.0.0.1:${PORTS.web}/login`) === 200, 120, "web、server");
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

// ---------------------------------------------------------------------------
// 文件备份与恢复
// ---------------------------------------------------------------------------

function copyFile(from, to) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); }

function backupFiles(plan) {
  for (const rel of [...plan.files.modified, ...plan.files.removed]) copyFile(path.join(runDir, safeRel(rel)), path.join(backupDir, "files", rel));
  if (fs.existsSync(path.join(runDir, INSTALLED_MANIFEST))) copyFile(path.join(runDir, INSTALLED_MANIFEST), path.join(backupDir, "installed-manifest.json"));
  writeJsonAtomic(path.join(backupDir, "plan.json"), { files: plan.files });
  status.backup_dir = path.relative(runDir, backupDir); save();
}

/** 把运行目录恢复到备份：还原被覆盖与被删除的文件，删除新增的文件。 */
function restoreFiles() {
  const { files } = readJson(path.join(backupDir, "plan.json"));
  for (const rel of files.added) fs.rmSync(path.join(runDir, safeRel(rel)), { force: true });
  for (const rel of [...files.modified, ...files.removed]) copyFile(path.join(backupDir, "files", safeRel(rel)), path.join(runDir, rel));
  const manifest = path.join(backupDir, "installed-manifest.json");
  if (fs.existsSync(manifest)) copyFile(manifest, path.join(runDir, INSTALLED_MANIFEST));
  else fs.rmSync(path.join(runDir, INSTALLED_MANIFEST), { force: true });
}

/**
 * 数据库目录与备份交换；当前目录改名保留，不删除。调用前数据库必须已停止。
 * 先把备份完整复制到任务目录（与运行目录同一文件系统），再用两次改名交换，复制失败时 `.pgdata` 不变。
 */
function restoreDatabaseDir() {
  const current = path.join(runDir, ".pgdata");
  const staged = path.join(dir, "pgdata-restoring");
  fs.rmSync(staged, { recursive: true, force: true });
  fs.cpSync(path.join(backupDir, "pgdata"), staged, { recursive: true, preserveTimestamps: true });
  const replaced = path.join(dir, `pgdata-replaced-${Date.now()}`);
  fs.renameSync(current, replaced);
  try { fs.renameSync(staged, current); } catch (error) { fs.renameSync(replaced, current); throw error; }
}

function applyFiles(plan) {
  for (const rel of [...plan.files.added, ...plan.files.modified]) {
    const target = path.join(runDir, safeRel(rel));
    copyFile(path.join(request.source_dir, rel), target);
    if (sha256File(target) !== plan.manifest[rel]) throw new Error(`复制后内容不一致：${rel}`);
  }
  for (const rel of plan.files.removed) fs.rmSync(path.join(runDir, safeRel(rel)), { force: true });
}

const needsInstall = (plan) => [...plan.files.added, ...plan.files.modified, ...plan.files.removed]
  .some((rel) => rel === "pnpm-lock.yaml" || rel === "pnpm-workspace.yaml" || rel.endsWith("package.json"));

async function installAndBuild() {
  await sh(pnpm, ["install", "--frozen-lockfile"]);
  await sh(pnpm, ["--filter", "@mailqivo/server", "typecheck"]);
  await sh(pnpm, ["--filter", "@mailqivo/web", "exec", "next", "build", "--webpack"]);
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

/** §7 运行验收：版本、登录、鉴权、受影响入口、MCP。 */
async function verifyRunning(targetVersion) {
  const env = readEnvFile(runDir);
  const api = `http://127.0.0.1:${PORTS.server}`;
  const web = `http://127.0.0.1:${PORTS.web}`;
  const health = await (await fetch(`${api}/healthz`)).json();
  if (health.version !== targetVersion) throw new Error(`运行版本为 ${health.version}，目标为 ${targetVersion}`);
  const login = await fetch(`${api}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: env.ADMIN_PASSWORD }) });
  const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
  if (login.status !== 200 || !cookie) throw new Error(`登录失败（HTTP ${login.status}）`);
  const failures = [];
  const expect = async (label, url, init, wanted) => { const code = await httpStatus(url, init); if (code !== wanted) failures.push(`${label}=${code}`); };
  await expect("未登录 /%61pi/auth/me", `${api}/%61pi/auth/me`, {}, 401);
  for (const route of ["/api/campaigns?limit=1", "/api/contacts?limit=1"]) await expect(route, `${api}${route}`, { headers: { cookie } }, 200);
  for (const route of ["/campaigns", "/contacts", "/settings/update"]) await expect(`web ${route}`, `${web}${route}`, { headers: { cookie } }, 200);
  const mcp = (body) => fetch(`${api}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${env.MCP_TOKEN}` },
    body: JSON.stringify(body)
  });
  await mcp({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "mailqivo-updater", version: "1" } } });
  const tools = await (await mcp({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })).json().catch(() => null);
  if (!tools?.result?.tools?.length) failures.push("MCP tools/list");
  if (failures.length) throw new Error(`未通过：${failures.join("，")}`);
  return `版本 ${health.version}；登录、鉴权、活动、联系人、Web 页面与 MCP（${tools.result.tools.length} 个工具）通过`;
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

async function runUpdate() {
  let plan;
  await stage("lock", true, async () => { plan = await lockAndRecheck(); });
  const app = plan.appUpdate;
  const migrate = app && plan.migrations.length > 0;
  await stage("verify_candidate", app, verifyCandidate);
  await stage("backup_files", app, async () => backupFiles(plan));
  let stoppedAt = null;
  let rollbackFrom = null; // 失败后需要恢复到的程度：files / database
  try {
    await stage("stop_services", app, async () => { stoppedAt = Date.now(); await stopAppServices(); });
  } catch (error) {
    status.error = `${status.error}；${await restartAfterFailure()}`;
    throw error;
  }
  try {
    await stage("backup_database", migrate, async () => {
      await stopDatabase();
      fs.cpSync(path.join(runDir, ".pgdata"), path.join(backupDir, "pgdata"), { recursive: true, preserveTimestamps: true });
      status.database_backed_up = true; save();
    });
    rollbackFrom = "files";
    await stage("apply_files", app, async () => applyFiles(plan));
    await stage("install", app && needsInstall(plan), () => sh(pnpm, ["install", "--frozen-lockfile"]));
    await stage("build", app, async () => {
      await sh(pnpm, ["--filter", "@mailqivo/server", "typecheck"]);
      await sh(pnpm, ["--filter", "@mailqivo/web", "exec", "next", "build", "--webpack"]);
    });
    await stage("migrate", app, async () => {
      await startDatabase();
      if (!migrate) return "无待执行迁移";
      rollbackFrom = "database";
      await sh(pnpm, ["db:migrate"]);
      return plan.migrations.join("、");
    });
  } catch (error) {
    // 服务端进程启动之前：自动回滚（§5.3）。
    if (rollbackFrom) await rollbackBeforeStart(rollbackFrom === "database");
    else status.error = `${status.error}；${await restartAfterFailure()}`;
    status.state = rollbackFrom ? "rolled_back" : "failed";
    throw Object.assign(error, { handled: true });
  }
  try {
    await stage("start_services", app, async () => { await startAppServices(); status.downtime_sec = Math.round((Date.now() - stoppedAt) / 1000); });
    status.app.now = appVersion(runDir); save();
    await stage("verify_running", app, () => verifyRunning(status.app.target));
    if (app) writeJsonAtomic(path.join(runDir, INSTALLED_MANIFEST), { version: status.app.target, commit: plan.commit, installed_at: new Date().toISOString(), files: plan.manifest });
  } catch (error) {
    status.state = "partial"; // 服务端进程已启动：不自动回滚（D5）。
    throw Object.assign(error, { handled: true });
  }
  try {
    await stage("plugin", plan.pluginUpdate, () => updatePlugin(status.plugin.target));
  } catch (error) {
    status.state = "partial";
    throw Object.assign(error, { handled: true });
  }
}

/** 自动回滚：恢复文件（与数据库），重新安装、构建旧版本，再启动服务。 */
async function rollbackBeforeStart(withDatabase) {
  log(`自动回滚（数据库：${withDatabase ? "恢复" : "不变"}）`);
  try {
    if (withDatabase) { await stopDatabase(); restoreDatabaseDir(); }
    restoreFiles();
    await installAndBuild();
    await startDatabase();
    await startAppServices();
    status.app.now = appVersion(runDir);
  } catch (error) {
    status.error = `${status.error ?? ""}；回滚失败：${error instanceof Error ? error.message : String(error)}；${await restartAfterFailure()}`;
    status.state = "failed";
    save();
    throw error;
  }
}

async function runPluginOnly() {
  await stage("lock", true, async () => {
    const plugin = await pluginStatus(findCodex());
    status.plugin.before = plugin.installed; save();
  });
  await stage("plugin", true, () => updatePlugin(status.plugin.target));
}

/** 手动回滚（D5）：恢复某个部分完成任务的备份；只有用户确认时才恢复数据库。 */
async function runRollback() {
  const source = taskDir(runDir, request.rollback_of);
  if (!fs.existsSync(path.join(source, "backup/plan.json"))) throw new Error("该任务没有可用的备份");
  fs.cpSync(path.join(source, "backup"), backupDir, { recursive: true });
  await stage("lock", true, async () => {});
  try {
    await stage("stop_services", true, async () => { await stopAppServices(); });
    await stage("apply_files", true, async () => {
      if (request.restore_database) { await stopDatabase(); restoreDatabaseDir(); }
      restoreFiles();
      return request.restore_database ? "文件与数据库已恢复" : "文件已恢复";
    });
    await stage("build", true, installAndBuild);
    await stage("start_services", true, async () => { await startDatabase(); await startAppServices(); });
  } catch (error) {
    // 停止服务开始后：任何失败（含停止本身中途失败）都尽力重新启动，不让 Web 与 API 停在关闭状态。
    status.error = `${status.error}；${await restartAfterFailure()}`;
    throw error;
  }
  status.app.now = appVersion(runDir); save();
  await stage("verify_running", true, () => verifyRunning(status.app.now));
}

status.state = "running"; status.pid = process.pid; save();
try {
  if (request.mode === "update") await runUpdate();
  else if (request.mode === "plugin") await runPluginOnly();
  else if (request.mode === "rollback") await runRollback();
  else throw new Error(`未知模式：${request.mode}`);
  status.state = "succeeded";
} catch (error) {
  if (!error?.handled && status.state === "running") status.state = "failed";
  if (!status.error) status.error = error instanceof Error ? error.message : String(error);
} finally {
  status.app.now = appVersion(runDir);
  try { const plugin = await pluginStatus(findCodex()); status.plugin.now = plugin.installed; status.plugin.enabled = plugin.enabled; } catch { /* 保留已有值 */ }
  if (status.state === "succeeded" && request.mode === "update" &&
      (status.app.now !== status.app.target || status.plugin.now !== status.plugin.target)) status.state = "partial";
  status.stage = null;
  status.finished_at = new Date().toISOString();
  status.stages.push({ name: "finish", result: "ok" });
  save();
  releaseCurrentTask(runDir, id);
  log(`结束：${status.state}`);
}
