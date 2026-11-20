/**
 * 版本更新的唯一实现库（实现规格「版本更新」）：API 的检查与更新程序共用。
 * 只依赖 Node 内置模块：更新程序把本文件复制到任务目录后运行，运行目录在更新中会被替换。
 */
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export const PLUGIN_ID = "mailqivo@mailqivo-local";
export const PLUGIN_DIR = "codex-marketplace/plugins/mailqivo";
export const PLUGIN_FILES = [
  ".codex-plugin/plugin.json",
  ".mcp.json",
  "assets/logo.png",
  "skills/edm-personalize/SKILL.md",
  "skills/edm-reply-triage/SKILL.md"
];
export const MIGRATIONS_DIR = "apps/server/src/db/migrations";
export const INSTALLED_MANIFEST = ".service/installed-manifest.json";
export const UPDATES_DIR = ".service/updates";
export const CURRENT_TASK_FILE = ".service/updates/current";
export const UPDATER_FILES = ["apps/server/src/update/lib.mjs", "apps/server/src/update/updater.mjs"];
/** 安装器固定的服务端口与 launchd 标签（scripts/install-codex.sh、ops/launchd/）。 */
export const PORTS = { postgres: 5432, web: 18090, server: 18091 };
export const LABELS = {
  postgres: "com.mailqivo.postgres",
  server: "com.mailqivo.server",
  web: "com.mailqivo.web",
  updater: "com.mailqivo.updater"
};
/** 候选源根目录的 release.json 未声明检查时，默认运行的候选验收（相对 apps/server）。 */
export const DEFAULT_CHECKS = ["scripts/check-campaign-deletion.ts"];

/** 更新程序永不读写的路径（相对运行目录）：配置、数据、服务状态、依赖与构建产物。 */
const PROTECTED = [
  /^\.env$/, /^\.env\./, /^\.pgdata(\/|$)/, /^data(\/|$)/, /^\.service(\/|$)/, /^\.git(\/|$)/,
  /(^|\/)node_modules(\/|$)/, /(^|\/)\.next(\/|$)/, /\.tsbuildinfo$/, /(^|\/)next-env\.d\.ts$/, /(^|\/)\.DS_Store$/
];
export const isProtected = (rel) => PROTECTED.some((pattern) => pattern.test(rel));
export const isTaskId = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(String(id));

/** 只接受仓库内的相对路径（不含 `..`、不是绝对路径）。 */
export function safeRel(rel) {
  if (!rel || path.isAbsolute(rel) || rel.split("/").some((part) => part === ".." || part === "")) throw new Error(`非法路径：${rel}`);
  return rel;
}

export const sha256 = (data) => createHash("sha256").update(data).digest("hex");
export const sha256File = (file) => sha256(fs.readFileSync(file));
export const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

export function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temp, file);
}

function readVersion(file) {
  try { return readJson(file).version ?? null; } catch { return null; }
}
export const appVersion = (dir) => readVersion(path.join(dir, "package.json"));
export const pluginVersion = (dir) => readVersion(path.join(dir, PLUGIN_DIR, ".codex-plugin/plugin.json"));

/** 严格语义版本比较：a > b 返回正数。 */
export function compareVersions(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

/** 运行目录 `.env` 的键值（只在本机内存中使用，不得写入日志或状态）。 */
export function readEnvFile(dir) {
  const values = {};
  for (const line of fs.readFileSync(path.join(dir, ".env"), "utf8").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (match) values[match[1]] = match[2];
  }
  return values;
}

/** 候选源（D1、D2）：已提交的 git 工作区。清单为 `git ls-files` 中非受保护文件的 sha256。 */
export async function readCandidate(sourceDir) {
  if (!sourceDir) return { ok: false, blocker: "SOURCE_NOT_CONFIGURED" };
  try {
    const git = async (...args) => (await run("git", ["-C", sourceDir, ...args], { maxBuffer: 64 << 20 })).stdout;
    const commit = (await git("rev-parse", "HEAD")).trim();
    const uncommitted = (await git("status", "--porcelain", "--untracked-files=no")).split("\n").filter(Boolean).map((line) => line.slice(3));
    const manifest = {};
    for (const rel of (await git("ls-files", "-z")).split("\0").filter(Boolean)) {
      if (isProtected(rel)) continue;
      const file = path.join(sourceDir, safeRel(rel));
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) throw new Error(`候选含符号链接：${rel}`);
      if (stat.isFile()) manifest[rel] = sha256File(file);
    }
    if (!appVersion(sourceDir)) throw new Error("候选缺少 package.json 版本");
    return { ok: true, commit, uncommitted, manifest, manifestSha256: sha256(JSON.stringify(Object.entries(manifest).sort())) };
  } catch (error) {
    return { ok: false, blocker: "SOURCE_INVALID", error: error instanceof Error ? error.message : String(error) };
  }
}

export function readInstalledManifest(runDir) {
  try { return readJson(path.join(runDir, INSTALLED_MANIFEST)); } catch { return null; }
}

/** 运行目录中给定根下的文件（不含受保护路径）；符号链接记为 "symlink"。 */
export function scanRunning(runDir, roots) {
  const files = {};
  const walk = (rel) => {
    if (isProtected(rel)) return;
    let stat;
    try { stat = fs.lstatSync(path.join(runDir, rel)); } catch { return; }
    if (stat.isSymbolicLink()) files[rel] = "symlink";
    else if (stat.isDirectory()) for (const name of fs.readdirSync(path.join(runDir, rel))) walk(`${rel}/${name}`);
    else if (stat.isFile()) files[rel] = sha256File(path.join(runDir, rel));
  };
  for (const root of roots) walk(root);
  return files;
}

const rootsOf = (files) => [...new Set(Object.keys(files).map((rel) => rel.split("/")[0]))];

/**
 * 没有安装清单时（D6）：运行目录中与候选不同或候选已删除的文件，内容不曾出现在候选 git 历史中 → 本机修改。
 */
async function unknownToHistory(runDir, sourceDir, rels) {
  const candidates = rels.filter((rel) => fs.lstatSync(path.join(runDir, rel)).isFile());
  const unknown = rels.filter((rel) => !candidates.includes(rel));
  if (!candidates.length) return unknown;
  const hashes = (await run("git", ["-C", sourceDir, "hash-object", "--", ...candidates.map((rel) => path.join(runDir, rel))], { maxBuffer: 16 << 20 })).stdout.trim().split("\n");
  const history = (await run("git", ["-C", sourceDir, "log", "--all", "--no-renames", "--pretty=format:", "--raw", "--no-abbrev", "--", ...candidates], { maxBuffer: 64 << 20 })).stdout;
  const known = new Map();
  for (const line of history.split("\n")) {
    const match = /^:\d+ \d+ [0-9a-f]+ ([0-9a-f]+) \w+\t(.+)$/.exec(line);
    if (match) known.set(match[2], (known.get(match[2]) ?? new Set()).add(match[1]));
  }
  candidates.forEach((rel, index) => { if (!known.get(rel)?.has(hashes[index])) unknown.push(rel); });
  return unknown;
}

/** 候选与运行目录的文件差异，以及运行目录中的本机修改（C4）。 */
export async function planFiles(runDir, sourceDir, candidate) {
  const installed = readInstalledManifest(runDir);
  const running = scanRunning(runDir, [...new Set([...rootsOf(candidate.manifest), ...rootsOf(installed?.files ?? {})])]);
  const added = [], modified = [], removed = [];
  for (const [rel, hash] of Object.entries(candidate.manifest)) {
    if (!(rel in running)) added.push(rel);
    else if (running[rel] !== hash) modified.push(rel);
  }
  for (const rel of Object.keys(running)) if (!(rel in candidate.manifest)) removed.push(rel);
  const localChanges = installed
    ? [...new Set([
      ...Object.keys(running).filter((rel) => installed.files[rel] !== running[rel]),
      ...Object.keys(installed.files).filter((rel) => !(rel in running))
    ])].filter((rel) => candidate.manifest[rel] !== running[rel])
    : await unknownToHistory(runDir, sourceDir, [...modified, ...removed]);
  return { added: added.sort(), modified: modified.sort(), removed: removed.sort(), localChanges: localChanges.sort() };
}

export function readJournal(dir) {
  return readJson(path.join(dir, MIGRATIONS_DIR, "meta/_journal.json")).entries.map((entry) => ({ tag: entry.tag, when: Number(entry.when) }));
}

/**
 * drizzle 只执行 `when` 晚于最后一条迁移记录的迁移。
 * - skipped：候选中早于最后一条记录、却没有记录的迁移，drizzle 会静默跳过 → 阻止（MIGRATION_SKIPPED）。
 * - databaseAhead：库中最后一条记录晚于候选全部迁移 → 阻止（DATABASE_AHEAD）。
 * - unknownRecords：库中有、候选不认识的记录数，只提示（例如开发期未入库的迁移）。
 */
export function analyzeMigrations(journal, recordedCreatedAt) {
  const recorded = new Set(recordedCreatedAt.map(Number));
  const last = recorded.size ? Math.max(...recorded) : -Infinity;
  const known = new Set(journal.map((entry) => entry.when));
  return {
    pending: journal.filter((entry) => entry.when > last).map((entry) => entry.tag),
    skipped: journal.filter((entry) => entry.when <= last && !recorded.has(entry.when)).map((entry) => entry.tag),
    databaseAhead: journal.length > 0 && last > Math.max(...known),
    unknownRecords: [...recorded].filter((when) => !known.has(when)).length
  };
}

/** Codex CLI：CODEX_CLI_PATH、PATH，再找桌面应用内置的 CLI（与安装器一致）。 */
export function findCodex(env = process.env) {
  const executable = (file) => { try { fs.accessSync(file, fs.constants.X_OK); return true; } catch { return false; } };
  if (env.CODEX_CLI_PATH && executable(env.CODEX_CLI_PATH)) return env.CODEX_CLI_PATH;
  for (const dir of (env.PATH ?? "").split(":")) if (dir && executable(path.join(dir, "codex"))) return path.join(dir, "codex");
  const home = env.HOME ?? os.homedir();
  for (const app of ["ChatGPT", "Codex"]) {
    for (const root of ["/Applications", path.join(home, "Applications")]) {
      const file = `${root}/${app}.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex`;
      if (executable(file)) return file;
    }
  }
  return null;
}

/**
 * 运行 Codex CLI（stdin 关闭）。Codex 读取远程插件目录时可能很慢（本机实测 84 秒），超时即抛错，
 * 由调用方报告 CODEX_UNAVAILABLE，不能把「无法读取」当成「未安装」。
 */
export function runCodex(codexBin, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (!codexBin) { reject(new Error("找不到 Codex CLI")); return; }
    const child = spawn(codexBin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-2000); });
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error(`Codex CLI ${Math.round(timeoutMs / 1000)} 秒内无响应`)); }, timeoutMs);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`Codex CLI 退出码 ${code}：${stderr.trim().slice(-500)}`));
    });
  });
}

export async function pluginStatus(codexBin, timeoutMs = 120_000) {
  const stdout = await runCodex(codexBin, ["plugin", "list", "--json"], timeoutMs);
  const item = JSON.parse(stdout).installed?.find((entry) => entry.pluginId === PLUGIN_ID);
  return { installed: item?.installed ? item.version ?? null : null, enabled: !!item?.enabled };
}

/** 插件缓存与给定插件目录逐文件一致，且只含 5 个运行文件（与安装器同一规则）。 */
export function pluginCacheMatches(pluginDir, version, home = os.homedir()) {
  const cache = path.join(home, ".codex/plugins/cache/mailqivo-local/mailqivo", version);
  try {
    const count = fs.readdirSync(cache, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).length;
    return count === PLUGIN_FILES.length && PLUGIN_FILES.every((rel) => sha256File(path.join(cache, rel)) === sha256File(path.join(pluginDir, rel)));
  } catch {
    return false;
  }
}

export const taskDir = (runDir, id) => path.join(runDir, UPDATES_DIR, id);
export function readTaskStatus(runDir, id) {
  try { return readJson(path.join(taskDir(runDir, id), "status.json")); } catch { return null; }
}
/** kickstart 后更新程序把状态改为 running 的最长等待时间；超过即视为未启动。 */
const QUEUED_GRACE_MS = 60_000;

/** 任务是否仍在执行：queued 在宽限期内，或 running 且更新程序进程（status.pid）仍存在。 */
export function isTaskAlive(status) {
  if (status.state === "queued") return Date.now() - Date.parse(status.created_at) < QUEUED_GRACE_MS;
  if (status.state !== "running" || !Number.isInteger(status.pid)) return false;
  try { process.kill(status.pid, 0); return true; } catch (error) { return error?.code === "EPERM"; }
}

/** 对外显示的任务状态：进程已不存在却仍为 queued / running 的任务显示为 failed（不改写 status.json）。 */
export function effectiveTaskStatus(status) {
  if ((status.state !== "queued" && status.state !== "running") || isTaskAlive(status)) return status;
  return { ...status, state: "failed", stage: null, error: status.error ?? "更新程序意外结束，任务未完成；请核对运行目录与服务状态后重新检查" };
}

function readCurrentPointer(runDir) {
  try { return fs.readFileSync(path.join(runDir, CURRENT_TASK_FILE), "utf8").trim(); } catch { return null; }
}

/** 未结束的任务 id（C5）；`current` 指向的任务已结束或进程已不存在时返回 null。 */
export function currentTask(runDir) {
  const id = readCurrentPointer(runDir);
  const status = isTaskId(id) ? readTaskStatus(runDir, id) : null;
  return status && isTaskAlive(status) ? id : null;
}

/** 只在 `current` 仍指向给定任务时删除它，不删除其他任务的指针。 */
export function releaseCurrentTask(runDir, id) {
  if (readCurrentPointer(runDir) === id) fs.rmSync(path.join(runDir, CURRENT_TASK_FILE), { force: true });
}
/** 最近一个任务的 id 与上次成功更新的停机秒数。 */
export function taskHistory(runDir) {
  let tasks = [];
  try {
    tasks = fs.readdirSync(path.join(runDir, UPDATES_DIR)).filter(isTaskId).map((id) => readTaskStatus(runDir, id)).filter(Boolean);
  } catch { /* 没有任务目录 */ }
  tasks.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const lastSucceeded = tasks.find((task) => task.state === "succeeded" && task.downtime_sec != null);
  return { last: tasks[0]?.id ?? null, downtime: lastSucceeded?.downtime_sec ?? null };
}

/**
 * 检查（§5.1）：计算版本、文件差异、迁移与阻止条件。
 * `database` 由调用方提供：{ recordedCreatedAt: number[], preparing: number, sending: number }。
 * `readPlugin` 读取插件状态；默认直接调用 Codex（120 秒）。API 传入带缓存的读取（R2）。
 */
export async function computeCheck({ runDir, sourceDir, database, readPlugin = () => pluginStatus(findCodex()) }) {
  const blockers = [];
  const candidate = await readCandidate(sourceDir);
  let plugin, codexError = null;
  try { plugin = await readPlugin(); } catch (error) { plugin = { installed: null, enabled: false }; codexError = error instanceof Error ? error.message : String(error); }
  const installedApp = appVersion(runDir);
  const history = taskHistory(runDir);
  const base = {
    source: { dir: sourceDir ?? null, commit: candidate.ok ? candidate.commit : null },
    app: { installed: installedApp, candidate: candidate.ok ? appVersion(sourceDir) : null },
    plugin: { installed: plugin.installed, enabled: plugin.enabled, candidate: candidate.ok ? pluginVersion(sourceDir) : null },
    files: { added: [], modified: [], removed: [] },
    migrations: { pending: [], unknown_records: 0 },
    backup_database: false,
    sending_campaigns: database.sending,
    estimated_downtime_sec: history.downtime,
    current_task: currentTask(runDir),
    last_task: history.last
  };
  if (!candidate.ok) {
    blockers.push({ code: candidate.blocker, ...(candidate.error ? { items: [candidate.error] } : {}) });
    return { check: { ...base, blockers, up_to_date: false }, plan: null };
  }
  if (codexError) blockers.push({ code: "CODEX_UNAVAILABLE", items: [codexError] });
  if (candidate.uncommitted.length) blockers.push({ code: "SOURCE_UNCOMMITTED", items: candidate.uncommitted });
  const files = await planFiles(runDir, sourceDir, candidate);
  const migrations = analyzeMigrations(readJournal(sourceDir), database.recordedCreatedAt);
  const appUpdate = files.added.length + files.modified.length + files.removed.length > 0;
  const pluginUpdate = base.plugin.installed !== base.plugin.candidate || !base.plugin.enabled;
  if (installedApp && compareVersions(base.app.candidate, installedApp) < 0) blockers.push({ code: "APP_DOWNGRADE", items: [`${installedApp} → ${base.app.candidate}`] });
  if (!codexError && base.plugin.installed && compareVersions(base.plugin.candidate, base.plugin.installed) < 0) {
    blockers.push({ code: "PLUGIN_DOWNGRADE", items: [`${base.plugin.installed} → ${base.plugin.candidate}`] });
  }
  if (base.plugin.installed && base.plugin.installed === base.plugin.candidate &&
      !pluginCacheMatches(path.join(sourceDir, PLUGIN_DIR), base.plugin.candidate)) blockers.push({ code: "PLUGIN_CONTENT_UNVERSIONED" });
  if (migrations.skipped.length) blockers.push({ code: "MIGRATION_SKIPPED", items: migrations.skipped });
  if (migrations.databaseAhead) blockers.push({ code: "DATABASE_AHEAD" });
  if (files.localChanges.length) blockers.push({ code: "LOCAL_CHANGES", items: files.localChanges });
  if (base.current_task) blockers.push({ code: "TASK_RUNNING", items: [base.current_task] });
  if (database.preparing) blockers.push({ code: "CAMPAIGN_PREPARING", items: [String(database.preparing)] });
  const check = {
    ...base,
    files: { added: files.added, modified: files.modified, removed: files.removed },
    migrations: { pending: migrations.pending, unknown_records: migrations.unknownRecords },
    backup_database: appUpdate && migrations.pending.length > 0,
    blockers,
    up_to_date: !appUpdate && !pluginUpdate
  };
  const plan = {
    commit: candidate.commit,
    manifest: candidate.manifest,
    manifestSha256: candidate.manifestSha256,
    appUpdate,
    pluginUpdate,
    files: { added: files.added, modified: files.modified, removed: files.removed },
    migrations: migrations.pending
  };
  return { check, plan };
}

/** 两步确认的摘要（§5.2）。 */
export function updateSummary(check, plan) {
  return {
    app: { installed: check.app.installed, candidate: check.app.candidate },
    plugin: { installed: check.plugin.installed, candidate: check.plugin.candidate },
    source_commit: check.source.commit,
    files: { added: check.files.added.length, modified: check.files.modified.length, removed: check.files.removed.length },
    migrations: check.migrations.pending,
    backup_database: check.backup_database,
    sending_campaigns: check.sending_campaigns,
    estimated_downtime_sec: check.estimated_downtime_sec,
    manifest_sha256: plan.manifestSha256
  };
}
