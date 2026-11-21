/**
 * 更新前检查（tasks/活动创建与发送修复计划.md §7.2；规格 §5.4、§6.1、§6.2）：
 *   pnpm --filter @mailqivo/server exec tsx scripts/check-campaign-send.ts
 *
 * 在临时 embedded-postgres 上运行，只使用合成记录，不读取也不连接 .env 的 DATABASE_URL。
 * SMTP 使用进程内替身，可切换为接受、拒绝认证，并统计 DATA 交接次数。覆盖：
 *  1. 迁移 0013：已排程、待准备的旧活动退回草稿。
 *  2. 创建前置条件：缺通道、缺退订、两项都缺、外部退订只配一半时拒绝创建，补齐后可创建。
 *  3. 模板导入诊断：报告异常片段与无默认值的未知变量；发送摘要不再因未知变量被阻止。
 *  4. 已停用附件不能被新的内容规则引用。
 *  5. 确认锁定名单：A、B 确认后新增 C、A 移除标签、B 退订，到点只为 A、B 建信，B 为 skipped，不建 C。
 *  6. 确认前同人数换人、只改正文 → CONFIRM_INVALID 且不重签；通道日用量变化不影响确认。
 *  7. 同一令牌重放、两个令牌并行、确认与 PATCH 并行：只成功一次，只有一份名单与邮件。
 *  8. SMTP 连接拒绝、认证拒绝 → CHANNEL_ERROR，活动为草稿，无名单行，无 SMTP 交接；IMAP 不可用不影响确认。
 *  9. 准备完成后名单行被删除。
 * 10. 暂停与完成交错、恢复与取消交错：落后的请求返回 INVALID_STATE。
 * 11. 已发邮件的 tracking_id：退订 GET、POST、One-Click 行为不变。
 */
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, inArray, like, ne, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { SESSION_COOKIE_NAME } from "@mailqivo/shared";
import { buildApp } from "../src/app.ts";
import { loadConfig, type Config } from "../src/config.ts";
import { createDb } from "../src/db/client.ts";
import { MIGRATIONS_DIR, runMigrations } from "../src/db/migrate.ts";
import { assets, campaignSendTargets, campaigns, channelDailyUsage, confirmTokens, contacts, contactTags, messages, tags } from "../src/db/schema.ts";
import { pauseCampaign, resumeCampaign } from "../src/modules/campaigns/service.ts";
import { runSchedulerOnce } from "../src/worker/scheduler.ts";
import { dayInTimezone } from "../src/lib/timezone.ts";
import { ensureDatabase, startEmbeddedPg } from "./lib/embedded-pg.ts";

/** 加入 campaign_send_targets 之前的最后一个迁移。 */
const BEFORE_SEND_TARGETS = "0012_campaign_physical_delete";

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok || detail === undefined ? "" : ` → ${JSON.stringify(detail)}`}`);
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    }).on("error", reject);
  });
}

function migrationsUpTo(tag: string, dir: string): string {
  fs.cpSync(MIGRATIONS_DIR, dir, { recursive: true });
  const journalPath = path.join(dir, "meta", "_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as { entries: { tag: string }[] };
  const end = journal.entries.findIndex((entry) => entry.tag === tag);
  if (end < 0) throw new Error(`迁移 ${tag} 不存在`);
  journal.entries = journal.entries.slice(0, end + 1);
  fs.writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

/** 进程内 SMTP 替身：只声明 AUTH PLAIN，不声明 STARTTLS；mode 控制认证结果，data 统计交接次数。 */
function startFakeSmtp(port: number) {
  const state = { mode: "accept" as "accept" | "reject_auth", data: 0 };
  const server = net.createServer((socket) => {
    let buffer = "";
    let inData = false;
    socket.write("220 fake ESMTP\r\n");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let index: number;
      while ((index = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (inData) {
          if (line === ".") { inData = false; socket.write("250 queued\r\n"); }
          continue;
        }
        const command = line.slice(0, 4).toUpperCase();
        if (command === "EHLO") socket.write("250-fake\r\n250 AUTH PLAIN\r\n");
        else if (command === "HELO") socket.write("250 fake\r\n");
        else if (command === "AUTH") socket.write(state.mode === "accept" ? "235 2.7.0 ok\r\n" : "535 5.7.8 authentication failed\r\n");
        else if (command === "MAIL" || command === "RCPT" || command === "RSET" || command === "NOOP") socket.write("250 ok\r\n");
        else if (command === "DATA") { state.data++; inData = true; socket.write("354 go\r\n"); }
        else if (command === "QUIT") { socket.write("221 bye\r\n"); socket.end(); }
        else socket.write("502 unsupported\r\n");
      }
    });
    socket.on("error", () => {});
  });
  return { state, ready: new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve)), close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mailqivo-send-check-"));
const port = await freePort();
const password = randomBytes(12).toString("hex");
const pg = await startEmbeddedPg({ dataDir: path.join(tmp, "pg"), port, user: "postgres", password, persistent: false });
const smtpPort = await freePort();
const closedPort = await freePort();
const smtp = startFakeSmtp(smtpPort);
await smtp.ready;
const handle = { close: async () => {} };
try {
  const conn = { user: "postgres", password, host: "127.0.0.1", port };
  await ensureDatabase(conn, "mailqivo_check", true);
  const databaseUrl = `postgres://postgres:${password}@127.0.0.1:${port}/mailqivo_check`;
  const { db, pool, close } = createDb(databaseUrl);
  handle.close = close;

  // 1. 迁移 0013
  const legacy = createDb(databaseUrl, { max: 1 });
  await migrate(legacy.db, { migrationsFolder: migrationsUpTo(BEFORE_SEND_TARGETS, path.join(tmp, "migrations")) });
  await legacy.close();
  const seeded = await pool.query(`
    INSERT INTO campaigns (name, subject, html, contact_filter, status, send_at) VALUES
      ('legacy-scheduled', 's', '<p>s</p>', '{}', 'scheduled', now() + interval '1 day'),
      ('legacy-preparing', 'p', '<p>p</p>', '{}', 'preparing', NULL),
      ('legacy-completed', 'c', '<p>c</p>', '{}', 'completed', NULL)
    RETURNING id, name`);
  // K3：迁移前已发出的邮件。迁移后用同一 tracking_id 核对退订（第 11 节）。
  const legacyMail = await pool.query(`
    WITH c AS (INSERT INTO contacts (email, source) VALUES ('legacy@legacy.test', 'manual') RETURNING id, email),
         k AS (INSERT INTO campaigns (name, subject, html, contact_filter, status) VALUES ('legacy-unsub', 'u', '<p>u</p>', '{}', 'completed') RETURNING id)
    INSERT INTO messages (campaign_id, contact_id, email, status, sent_at)
    SELECT k.id, c.id, c.email, 'sent', now() FROM c, k
    RETURNING id, campaign_id, contact_id, tracking_id`);
  const legacyMessage = legacyMail.rows[0] as { id: string; campaign_id: string; contact_id: string; tracking_id: string };
  await runMigrations(databaseUrl);
  const legacyRows = await db.select({ name: campaigns.name, status: campaigns.status, send_at: campaigns.send_at }).from(campaigns)
    .where(inArray(campaigns.id, seeded.rows.map((row) => row.id as string)));
  const byName = Object.fromEntries(legacyRows.map((row) => [row.name, row]));
  check("迁移 0013：已排程活动退回草稿并保留 send_at", byName["legacy-scheduled"]?.status === "draft" && !!byName["legacy-scheduled"]?.send_at, byName["legacy-scheduled"]);
  check("迁移 0013：待准备活动退回草稿", byName["legacy-preparing"]?.status === "draft", byName["legacy-preparing"]);
  check("迁移 0013：其他状态不变", byName["legacy-completed"]?.status === "completed", byName["legacy-completed"]);
  const [migratedMessage] = await db.select({ tracking_id: messages.tracking_id, contact_id: messages.contact_id, status: messages.status })
    .from(messages).where(eq(messages.id, legacyMessage.id));
  check("迁移 0013：已发邮件的 tracking_id、联系人与状态不变",
    migratedMessage?.tracking_id === legacyMessage.tracking_id && migratedMessage?.contact_id === legacyMessage.contact_id && migratedMessage?.status === "sent", migratedMessage);
  await db.delete(campaigns).where(ne(campaigns.id, legacyMessage.campaign_id));

  const assetDir = path.join(tmp, "assets");
  fs.mkdirSync(assetDir);
  const base = loadConfig({
    DATABASE_URL: databaseUrl, PUBLIC_BASE_URL: "http://127.0.0.1:18090", MAIL_ID_DOMAIN: "example.test",
    MAIL_PUBLIC_BASE_URL: "https://mail.example.com", APP_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    ADMIN_PASSWORD: "check-password", SESSION_SECRET: randomBytes(32).toString("hex"), MCP_TOKEN: randomBytes(32).toString("hex"),
    ASSET_DIR: assetDir, ROLE: "api", APP_TIMEZONE: "Asia/Shanghai"
  });

  async function session(config: Config) {
    const app = await buildApp({ config, db, llm: null });
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: "check-password" } });
    const cookie = login.cookies.find((item) => item.name === SESSION_COOKIE_NAME);
    const headers = { cookie: `${SESSION_COOKIE_NAME}=${cookie?.value ?? ""}` };
    const api = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: object) =>
      app.inject({ method, url, headers, ...(payload ? { payload } : {}) });
    return { app, api };
  }
  const campaignBody = (name: string, extra: Record<string, unknown> = {}) => ({
    name, subject: name, html: "<p>Hello {{姓名|朋友}}</p>", contact_filter: { tags_any: ["aud"] }, ...extra
  });

  // 2. 创建前置条件
  {
    const cases: [string, Partial<Config>, string[]][] = [
      ["缺通道", {}, ["channel"]],
      ["缺通道与退订", { MAIL_PUBLIC_BASE_URL: undefined }, ["channel", "unsubscribe"]],
      ["外部退订只配地址（有内置基址）", { UNSUBSCRIBE_PUBLIC_URL: "https://unsub.example.com/u" }, ["channel", "unsubscribe"]]
    ];
    for (const [label, override, expected] of cases) {
      const { app, api } = await session({ ...base, ...override });
      const pre = (await api("GET", "/api/campaigns/prerequisites")).json() as { ready: boolean; missing: string[] };
      const created = await api("POST", "/api/campaigns", campaignBody(`pre-${label}`));
      check(`前置条件 ${label}：列出全部缺项且拒绝创建`,
        !pre.ready && JSON.stringify(pre.missing) === JSON.stringify(expected) && created.statusCode === 400 &&
        JSON.stringify(created.json().error?.details?.missing) === JSON.stringify(expected),
        { pre, status: created.statusCode, body: created.json() });
      await app.close();
    }
  }
  const { app, api } = await session(base);
  try {
    const channelBody = (name: string, smtpPort: number, imapPort: number, isDefault: boolean) => ({
      name, from_email: "sender@example.test", from_name: "Check", reply_to: "sender@example.test",
      smtp: { host: "127.0.0.1", port: smtpPort, secure: false, user: "u", pass: "p" },
      imap: { host: "127.0.0.1", port: imapPort, secure: false, user: "sender@example.test", pass: "p" },
      rate_per_minute: 1000, daily_limit: 300, is_default: isDefault
    });
    const goodChannel = await api("POST", "/api/channels", channelBody("good", smtpPort, closedPort, true));
    const goodChannelId = goodChannel.json().id as string;
    const deadChannelId = (await api("POST", "/api/channels", channelBody("dead", closedPort, closedPort, false))).json().id as string;
    check("创建通道", goodChannel.statusCode === 201 && !!goodChannelId && !!deadChannelId, goodChannel.json());
    // 默认页尾引用 {{公司名}}；合成环境补齐公司信息，避免准备阶段因设置缺值失败。
    await api("PATCH", "/api/settings", { company_name: "Check Co.", company_address: "Check Road 1" });
    {
      const pre = (await api("GET", "/api/campaigns/prerequisites")).json();
      check("前置条件齐全时 ready", pre.ready === true && pre.missing.length === 0, pre);
    }
    {
      const { app: halfApp, api: halfApi } = await session({ ...base, UNSUBSCRIBE_SHARED_SECRET: "x".repeat(32) });
      const created = await halfApi("POST", "/api/campaigns", campaignBody("half-unsub"));
      check("外部退订只配密钥时拒绝创建", created.statusCode === 400 && JSON.stringify(created.json().error?.details?.missing) === '["unsubscribe"]', created.json());
      await halfApp.close();
    }

    // 联系人与客群标签
    const [aud] = await db.insert(tags).values({ name: "aud" }).returning();
    const addContacts = async (emails: string[]) => {
      const rows = await db.insert(contacts).values(emails.map((email) => ({ email, name: email.split("@")[0], source: "manual" }))).returning();
      await db.insert(contactTags).values(rows.map((row) => ({ contact_id: row.id, tag_id: aud!.id })));
      return rows;
    };
    const create = async (name: string, extra: Record<string, unknown> = {}) => {
      const response = await api("POST", "/api/campaigns", campaignBody(name, extra));
      if (response.statusCode !== 201) throw new Error(`创建活动失败：${response.body}`);
      return response.json().id as string;
    };
    const summary = async (id: string, payload: object = {}) => api("POST", `/api/campaigns/${id}/send`, payload);
    const confirm = async (id: string, token: string, payload: object = {}) => api("POST", `/api/campaigns/${id}/send`, { ...payload, confirm_token: token });
    const statusOf = async (id: string) => (await db.select({ status: campaigns.status }).from(campaigns).where(eq(campaigns.id, id)))[0]?.status;
    const targetCount = async (id: string) => (await db.select({ n: sql<number>`count(*)::int` }).from(campaignSendTargets).where(eq(campaignSendTargets.campaign_id, id)))[0]!.n;
    const messageEmails = async (id: string) => (await db.select({ email: messages.email, status: messages.status, skip: messages.skip_reason }).from(messages)
      .where(and(eq(messages.campaign_id, id), eq(messages.is_test, false)))).sort((a, b) => a.email.localeCompare(b.email));

    // 3. 模板导入诊断
    {
      const html = "<p>{{公司}} {{未知字段}} {{ai.intro}} {{好|默认}} {{坏-键}} 尾部}}</p>";
      const template = await api("POST", "/api/templates", { name: "diag", subject: "diag", html });
      const diag = await api("POST", `/api/templates/${template.json().id}/diagnose`, { html, ai_block_keys: ["intro"] });
      const response = diag.json();
      const issues = response.issues as { kind: string; key?: string; fragment?: string }[] | undefined;
      const valid = diag.statusCode === 200 && Array.isArray(issues);
      check("模板诊断请求成功", valid, response);
      if (valid) {
        const unknownKeys = issues.filter((item) => item.kind === "unknown_variable").map((item) => item.key);
        const syntax = issues.filter((item) => item.kind === "syntax").map((item) => item.fragment ?? "");
        check("模板诊断：报告无默认值的未知变量，不报内置变量、AI 区块与有默认值的变量",
          JSON.stringify(unknownKeys) === '["未知字段"]', issues);
        check("模板诊断：报告无法解析的片段，每处一条", JSON.stringify(syntax) === JSON.stringify(["{{坏-键}}", " 尾部}}"]), issues);
      }
    }

    // 4. 已停用附件不能被新规则引用
    {
      const [asset] = await db.insert(assets).values({ filename: "off.pdf", storage_key: "off.pdf", mime_type: "application/pdf", size_bytes: 1, sha256: "0".repeat(64), enabled: false }).returning();
      const response = await api("POST", "/api/campaigns", campaignBody("disabled-asset", {
        content_rules: [{ name: "r", tags_all: ["aud"], attachment_ids: [asset!.id], priority: 1 }]
      }));
      check("已停用附件不能在新建活动的规则中引用", response.statusCode === 400 && JSON.stringify(response.json().error?.details ?? {}).includes("DISABLED"), response.json());
      const reported = response.json().error?.details?.rules?.[0]?.assets?.[0];
      check("失效附件错误带文件名与原因", reported?.asset_id === asset!.id && reported?.filename === "off.pdf" && reported?.problem === "DISABLED", reported);
    }

    // 5. 名单锁定（定时路径，经 scheduler 到点准备）
    {
      const [a, b] = await addContacts(["a@example.test", "b@example.test"]);
      const id = await create("lock", { html: "<p>Hello {{未知字段}}</p>" });
      const sendAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const first = await summary(id, { send_at: sendAt });
      check("摘要不再因未知变量被阻止", first.statusCode === 200 && first.json().summary?.recipients === 2, first.json());
      const done = await confirm(id, first.json().confirm_token, { send_at: sendAt });
      check("定时确认成功并写入名单", done.statusCode === 200 && done.json().status === "scheduled" && (await targetCount(id)) === 2, done.json());
      const [c] = await addContacts(["c@example.test"]);
      await db.delete(contactTags).where(and(eq(contactTags.contact_id, a!.id), eq(contactTags.tag_id, aud!.id)));
      await db.update(contacts).set({ status: "unsubscribed", unsubscribed_at: new Date() }).where(eq(contacts.id, b!.id));
      await db.update(campaigns).set({ send_at: new Date(Date.now() - 1000) }).where(eq(campaigns.id, id));
      await runSchedulerOnce(db, base);
      const rows = await messageEmails(id);
      check("到点只为确认时的 A、B 建信，B 退订后为 skipped，不追加 C",
        JSON.stringify(rows) === JSON.stringify([
          { email: "a@example.test", status: "queued", skip: null },
          { email: "b@example.test", status: "skipped", skip: "CONTACT_UNSUBSCRIBED" }
        ]) && c !== undefined, rows);
      check("准备完成后名单行被删除", (await targetCount(id)) === 0);
      await runSchedulerOnce(db, base);
      check("重复调度不重复建信", (await messageEmails(id)).length === 2);
      await db.delete(contactTags);
      await db.delete(contacts).where(like(contacts.email, "%@example.test"));
    }

    // 5b. 确认时的资格只减不增；标签规则与附件快照在名单删除前写入
    {
      const [vip] = await db.insert(tags).values({ name: "vip" }).returning();
      const fileBody = Buffer.from("vip attachment");
      const storageKey = `${randomUUID()}.pdf`;
      fs.writeFileSync(path.join(assetDir, storageKey), fileBody);
      const sha = createHash("sha256").update(fileBody).digest("hex");
      const [asset] = await db.insert(assets).values({ filename: "vip.pdf", storage_key: storageKey, mime_type: "application/pdf", size_bytes: fileBody.length, sha256: sha, enabled: true }).returning();
      const [g, , k] = await addContacts(["g@example.test", "h@example.test", "k@example.test"]);
      await db.insert(contactTags).values([g!, k!].map((row) => ({ contact_id: row.id, tag_id: vip!.id })));
      await db.update(contacts).set({ status: "unsubscribed", unsubscribed_at: new Date() }).where(eq(contacts.id, k!.id));
      const id = await create("rules", { content_rules: [{ name: "vip", tags_all: ["vip"], attachment_ids: [asset!.id], priority: 1 }] });
      const sendAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const first = await summary(id, { send_at: sendAt });
      const done = await confirm(id, first.json().confirm_token, { send_at: sendAt });
      check("带规则活动定时确认成功", done.statusCode === 200 && done.json().status === "scheduled", done.json());
      await db.update(contacts).set({ status: "active", unsubscribed_at: null }).where(eq(contacts.id, k!.id));
      await db.update(campaigns).set({ send_at: new Date(Date.now() - 1000) }).where(eq(campaigns.id, id));
      await runSchedulerOnce(db, base);
      const rows = await db.select({ email: messages.email, status: messages.status, skip: messages.skip_reason, rule: messages.content_rule_snapshot, files: messages.attachment_snapshot })
        .from(messages).where(eq(messages.campaign_id, id));
      const byEmail = Object.fromEntries(rows.map((row) => [row.email, row]));
      const gRow = byEmail["g@example.test"];
      check("命中标签规则的收件人写入规则与附件快照",
        gRow?.status === "queued" && (gRow.rule as { name?: string } | null)?.name === "vip" &&
        JSON.stringify((gRow.files as { asset_id: string }[] | null)?.map((item) => item.asset_id)) === JSON.stringify([asset!.id]), rows);
      check("未命中规则的收件人无规则快照", byEmail["h@example.test"]?.status === "queued" && byEmail["h@example.test"]?.rule === null, rows);
      check("确认时已跳过、到点前恢复 active 的联系人仍为 skipped",
        byEmail["k@example.test"]?.status === "skipped" && byEmail["k@example.test"]?.skip === "CONTACT_UNSUBSCRIBED", rows);
      check("带规则活动准备后名单行被删除", (await targetCount(id)) === 0);
      await db.delete(contactTags);
      await db.delete(contacts).where(like(contacts.email, "%@example.test"));
    }

    // 5c. 确认后全部成员失去资格
    {
      const rows = await addContacts(["m@example.test", "n@example.test"]);
      const id = await create("all-gone");
      const sendAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const first = await summary(id, { send_at: sendAt });
      await confirm(id, first.json().confirm_token, { send_at: sendAt });
      await db.update(contacts).set({ status: "unsubscribed", unsubscribed_at: new Date() }).where(inArray(contacts.id, rows.map((row) => row.id)));
      await db.update(campaigns).set({ send_at: new Date(Date.now() - 1000) }).where(eq(campaigns.id, id));
      await runSchedulerOnce(db, base);
      const [row] = await db.select().from(campaigns).where(eq(campaigns.id, id));
      const written = await messageEmails(id);
      check("全部退订：逐人写 skipped 明细，活动 failed",
        row?.status === "failed" && row.fail_reason === "收件人为 0" && written.length === 2 && written.every((item) => item.status === "skipped" && item.skip === "CONTACT_UNSUBSCRIBED"),
        { status: row?.status, reason: row?.fail_reason, written });
      check("全部退订：名单行被删除", (await targetCount(id)) === 0);
      await db.delete(contactTags);
      await db.delete(contacts).where(like(contacts.email, "%@example.test"));
    }

    // 6. 确认前的变化
    {
      await addContacts(["d@example.test", "e@example.test"]);
      const id = await create("swap");
      const first = await summary(id);
      const [e] = await db.select().from(contacts).where(eq(contacts.email, "e@example.test"));
      await db.delete(contactTags).where(eq(contactTags.contact_id, e!.id));
      await addContacts(["f@example.test"]);
      const swapped = await confirm(id, first.json().confirm_token);
      check("同人数换人 → CONFIRM_INVALID 且不重签", swapped.statusCode === 409 && swapped.json().error?.code === "CONFIRM_INVALID" &&
        swapped.json().error?.details?.confirm_token === undefined && (await statusOf(id)) === "draft", swapped.json());

      const second = await summary(id);
      const draft = (await api("GET", `/api/campaigns/${id}`)).json();
      await api("PATCH", `/api/campaigns/${id}`, { ...draft, html: "<p>changed</p>" });
      const edited = await confirm(id, second.json().confirm_token);
      check("确认前只改正文 → CONFIRM_INVALID", edited.statusCode === 409 && edited.json().error?.code === "CONFIRM_INVALID" && (await statusOf(id)) === "draft", edited.json());

      const third = await summary(id);
      const day = dayInTimezone(new Date(), base.APP_TIMEZONE);
      await db.insert(channelDailyUsage).values({ channel_id: goodChannelId, day, count: 5 })
        .onConflictDoUpdate({ target: [channelDailyUsage.channel_id, channelDailyUsage.day], set: { count: 5 } });
      const before = smtp.state.data;
      const ok = await confirm(id, third.json().confirm_token);
      check("通道日用量变化不影响确认", ok.statusCode === 200 && ok.json().status === "sending", ok.json());
      check("确认只验证 SMTP，不交接邮件", smtp.state.data === before, { data: smtp.state.data, before });
      check("立即发送后名单行已删除", (await targetCount(id)) === 0);
      const immediateRows = await messageEmails(id);
      check("立即发送只为确认时的 D、F 建信，不含已移出客群的 E",
        JSON.stringify(immediateRows) === JSON.stringify([
          { email: "d@example.test", status: "queued", skip: null },
          { email: "f@example.test", status: "queued", skip: null }
        ]), immediateRows);
      const replay = await confirm(id, third.json().confirm_token);
      check("同一令牌重放被拒绝", replay.statusCode === 409, replay.json());
      check("重放不产生第二份邮件", (await messageEmails(id)).length === 2);
      await db.update(campaigns).set({ status: "completed" }).where(eq(campaigns.id, id));
    }

    // 7. 并行确认与 PATCH
    {
      const id = await create("parallel");
      const firstSummary = (await summary(id)).json();
      const one = firstSummary.confirm_token as string;
      const two = (await summary(id)).json().confirm_token as string;
      const results = await Promise.all([confirm(id, one), confirm(id, two)]);
      const succeeded = results.filter((item) => item.statusCode === 200).length;
      check("两个令牌并行只成功一次", succeeded === 1, results.map((item) => item.statusCode));
      check("并行确认只产生一份邮件", (await messageEmails(id)).length === firstSummary.summary.recipients, { messages: await messageEmails(id), recipients: firstSummary.summary.recipients });

      const id2 = await create("patch-race");
      const token = (await summary(id2)).json().confirm_token as string;
      const draft = (await api("GET", `/api/campaigns/${id2}`)).json();
      const [sent, patched] = await Promise.all([confirm(id2, token), api("PATCH", `/api/campaigns/${id2}`, { ...draft, html: "<p>race</p>" })]);
      const after = (await db.select({ status: campaigns.status, html: campaigns.html }).from(campaigns).where(eq(campaigns.id, id2)))[0]!;
      const consistent = (sent.statusCode === 200 && patched.statusCode === 409 && after.html !== "<p>race</p>") ||
        (sent.statusCode === 409 && patched.statusCode === 200 && after.status === "draft");
      check("确认与 PATCH 并行只有一方成功，已确认内容不被覆盖", consistent, { send: sent.statusCode, patch: patched.statusCode, after });
    }

    // 8. SMTP 失败
    {
      const before = smtp.state.data;
      const refused = await create("smtp-refused", { channel_id: deadChannelId });
      const r1 = await confirm(refused, (await summary(refused)).json().confirm_token);
      check("SMTP 连接拒绝 → CHANNEL_ERROR，草稿，无名单行", r1.json().error?.code === "CHANNEL_ERROR" && (await statusOf(refused)) === "draft" && (await targetCount(refused)) === 0, r1.json());
      smtp.state.mode = "reject_auth";
      const rejected = await create("smtp-auth");
      const rejectedToken = (await summary(rejected)).json().confirm_token as string;
      const r2 = await confirm(rejected, rejectedToken);
      check("SMTP 认证拒绝 → CHANNEL_ERROR，草稿，无名单行", r2.json().error?.code === "CHANNEL_ERROR" && (await statusOf(rejected)) === "draft" && (await targetCount(rejected)) === 0, r2.json());
      smtp.state.mode = "accept";
      check("SMTP 失败时无交接", smtp.state.data === before, { data: smtp.state.data, before });
      const [usedToken] = await db.select({ used_at: confirmTokens.used_at }).from(confirmTokens).where(eq(confirmTokens.token, rejectedToken));
      check("SMTP 失败后原令牌已标记使用", !!usedToken?.used_at, usedToken);
      const retry = await confirm(rejected, rejectedToken);
      check("SMTP 失败后用原令牌重试返回 CONFIRM_INVALID，活动仍为草稿",
        retry.statusCode === 409 && retry.json().error?.code === "CONFIRM_INVALID" && (await statusOf(rejected)) === "draft" && (await targetCount(rejected)) === 0, retry.json());
      const imapDown = await create("imap-down");
      const r3 = await confirm(imapDown, (await summary(imapDown)).json().confirm_token);
      check("IMAP 不可用、SMTP 正常时确认成功", r3.statusCode === 200 && r3.json().status === "sending", r3.json());
    }

    // 10. 暂停、恢复与取消的并发
    {
      const raceWith = async (id: string, act: () => Promise<unknown>, concurrent: string) => {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query("SELECT 1 FROM campaigns WHERE id = $1 FOR UPDATE", [id]);
          const pending = act().then(() => null, (error: unknown) => error);
          await new Promise((resolve) => setTimeout(resolve, 300));
          await client.query("UPDATE campaigns SET status = $2 WHERE id = $1", [id, concurrent]);
          await client.query("COMMIT");
          return await pending;
        } finally {
          client.release();
        }
      };
      const sendingId = await create("race-pause");
      await db.update(campaigns).set({ status: "sending" }).where(eq(campaigns.id, sendingId));
      const pauseError = await raceWith(sendingId, () => pauseCampaign(db, sendingId), "completed");
      check("暂停与完成交错：暂停返回 INVALID_STATE，保留 completed",
        (pauseError as { code?: string } | null)?.code === "INVALID_STATE" && (await statusOf(sendingId)) === "completed", { error: String(pauseError), status: await statusOf(sendingId) });
      const pausedId = await create("race-resume");
      await db.update(campaigns).set({ status: "paused" }).where(eq(campaigns.id, pausedId));
      const resumeError = await raceWith(pausedId, () => resumeCampaign(db, pausedId), "cancelled");
      check("恢复与取消交错：恢复返回 INVALID_STATE，保留 cancelled",
        (resumeError as { code?: string } | null)?.code === "INVALID_STATE" && (await statusOf(pausedId)) === "cancelled", { error: String(resumeError), status: await statusOf(pausedId) });
    }

    // 11. 迁移前已发邮件的退订（K3：同一 tracking_id）
    {
      const contactId = legacyMessage.contact_id;
      const trackingId = legacyMessage.tracking_id;
      const statusNow = async () => (await db.select().from(contacts).where(eq(contacts.id, contactId)))[0];
      const page = await app.inject({ method: "GET", url: `/u/${trackingId}` });
      check("旧 tracking_id：退订 GET 显示确认页且不改状态", page.statusCode === 200 && (await statusNow())?.status === "active", page.statusCode);
      const posted = await app.inject({ method: "POST", url: `/u/${trackingId}` });
      const afterPost = await statusNow();
      check("旧 tracking_id：退订 POST 生效", posted.statusCode === 200 && afterPost?.status === "unsubscribed", { status: posted.statusCode, contact: afterPost?.status });
      const oneClick = await app.inject({ method: "POST", url: `/u/${trackingId}`, headers: { "content-type": "application/x-www-form-urlencoded" }, payload: "List-Unsubscribe=One-Click" });
      const afterOneClick = await statusNow();
      check("旧 tracking_id：One-Click 返回 200 且保留首次退订时间", oneClick.statusCode === 200 && afterOneClick?.unsubscribed_at?.getTime() === afterPost?.unsubscribed_at?.getTime(), oneClick.statusCode);
    }
  } finally {
    await app.close();
  }
} finally {
  await handle.close();
  await pg.stop();
  await smtp.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} 项未通过` : "\n活动发送检查全部通过");
process.exitCode = failures ? 1 : 0;

