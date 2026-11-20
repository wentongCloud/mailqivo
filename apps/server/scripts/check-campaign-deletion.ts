/**
 * 更新前检查（AGENTS.md、规格 §6.1「活动删除与更新验收」）：
 *   pnpm --filter @mailqivo/server exec tsx scripts/check-campaign-deletion.ts
 *
 * 在临时 embedded-postgres 上运行，只使用合成记录，不读取也不连接 .env 的 DATABASE_URL。覆盖：
 * 1. 迁移 0012：历史软删活动被永久删除，deleted_at 列移除，联系人保留。
 * 2. 列表、详情与删除 API：草稿与已完成活动永久删除（邮件随之删除）；其他状态 409；再次删除与详情 404。
 * 3. 删除后，删除前取得的 unknown 回收令牌返回 404。
 * 4. 退订属于联系人：删除前已退订的联系人保持退订；已删除活动的原退订链接返回 404。
 * 5. 退信属于联系人：原邮件已删除时，webhook 与 IMAP DSN 按退信邮箱对联系人生效。
 */
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { SESSION_COOKIE_NAME } from "@mailqivo/shared";
import { buildApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { createDb } from "../src/db/client.ts";
import { MIGRATIONS_DIR, runMigrations } from "../src/db/migrate.ts";
import { campaigns, channels, contacts, messages } from "../src/db/schema.ts";
import { processInboundMail } from "../src/inbound/process.ts";
import { ensureDatabase, startEmbeddedPg } from "./lib/embedded-pg.ts";

/** 删除契约之前的最后一个迁移；第 1 项在它之上写入历史软删记录，再执行其余迁移。 */
const LAST_SOFT_DELETE_MIGRATION = "0011_message_prepare_failures";

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

/** 复制迁移目录并截断 journal，用于先迁移到删除契约之前的版本。 */
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mailqivo-deletion-check-"));
const port = await freePort();
const password = randomBytes(12).toString("hex");
const pg = await startEmbeddedPg({ dataDir: path.join(tmp, "pg"), port, user: "postgres", password, persistent: false });
const handle = { close: async () => {} };
try {
  const conn = { user: "postgres", password, host: "127.0.0.1", port };
  await ensureDatabase(conn, "mailqivo_check", true);
  const databaseUrl = `postgres://postgres:${password}@127.0.0.1:${port}/mailqivo_check`;
  const { db, pool, close } = createDb(databaseUrl);
  handle.close = close;

  // 1. 历史软删记录与迁移 0012
  const legacy = createDb(databaseUrl, { max: 1 });
  await migrate(legacy.db, { migrationsFolder: migrationsUpTo(LAST_SOFT_DELETE_MIGRATION, path.join(tmp, "migrations")) });
  await legacy.close();
  const seeded = await pool.query(`
    WITH contact AS (INSERT INTO contacts (email, source) VALUES ('legacy@example.test', 'manual') RETURNING id),
    campaign AS (INSERT INTO campaigns (name, subject, html, contact_filter, status, deleted_at)
      VALUES ('legacy', 'legacy', '<p>legacy</p>', '{}', 'completed', now()) RETURNING id)
    INSERT INTO messages (campaign_id, contact_id, email, status, sent_at)
    SELECT campaign.id, contact.id, 'legacy@example.test', 'sent', now() FROM campaign, contact RETURNING campaign_id`);
  const legacyCampaignId = seeded.rows[0].campaign_id as string;
  await runMigrations(databaseUrl);
  const legacyLeft = await pool.query("SELECT (SELECT count(*)::int FROM campaigns WHERE id = $1) AS campaigns, (SELECT count(*)::int FROM messages WHERE campaign_id = $1) AS messages", [legacyCampaignId]);
  check("迁移 0012 永久删除历史软删活动及其邮件", legacyLeft.rows[0].campaigns === 0 && legacyLeft.rows[0].messages === 0, legacyLeft.rows[0]);
  const column = await pool.query("SELECT 1 FROM information_schema.columns WHERE table_name = 'campaigns' AND column_name = 'deleted_at'");
  check("迁移 0012 移除 deleted_at 列", column.rowCount === 0);
  const [legacyContact] = await db.select().from(contacts).where(eq(contacts.email, "legacy@example.test"));
  check("迁移 0012 保留联系人及其状态", legacyContact?.status === "active", legacyContact?.status);

  // 2–5. 删除 API、退订与退信
  const assetDir = path.join(tmp, "assets");
  fs.mkdirSync(assetDir);
  const config = loadConfig({
    DATABASE_URL: databaseUrl, PUBLIC_BASE_URL: "http://127.0.0.1:18090", MAIL_ID_DOMAIN: "example.test",
    MAIL_PUBLIC_BASE_URL: "https://mail.example.com", APP_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    ADMIN_PASSWORD: "check-password", SESSION_SECRET: randomBytes(32).toString("hex"), MCP_TOKEN: randomBytes(32).toString("hex"),
    ASSET_DIR: assetDir, ROLE: "api"
  });
  const app = await buildApp({ config, db, llm: null });
  try {
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: "check-password" } });
    const session = login.cookies.find((cookie) => cookie.name === SESSION_COOKIE_NAME);
    check("登录", login.statusCode === 200 && !!session, login.statusCode);
    const headers = { cookie: `${SESSION_COOKIE_NAME}=${session?.value ?? ""}` };
    const api = (method: "GET" | "DELETE" | "POST", url: string, payload?: object) => app.inject({ method, url, headers, ...(payload ? { payload } : {}) });

    const [alice, carol, dave] = await db.insert(contacts).values([
      { email: "alice@example.test", source: "manual" },
      { email: "carol@example.test", source: "manual" },
      { email: "dave@example.test", source: "manual" }
    ]).returning();
    const insertCampaign = async (name: string, status: string) =>
      (await db.insert(campaigns).values({ name, subject: name, html: `<p>${name}</p>`, contact_filter: {}, status }).returning({ id: campaigns.id }))[0]!.id;
    const draftId = await insertCampaign("check-draft", "draft");
    const completedId = await insertCampaign("check-completed", "completed");
    const sendingId = await insertCampaign("check-sending", "sending");
    const sent = await db.insert(messages).values([alice!, carol!, dave!].map((contact) => ({
      campaign_id: completedId, contact_id: contact.id, email: contact.email, status: "sent", sent_at: new Date()
    }))).returning({ tracking_id: messages.tracking_id, email: messages.email });
    const tracking = Object.fromEntries(sent.map((row) => [row.email, row.tracking_id]));

    const list = await api("GET", "/api/campaigns?limit=100");
    const listed = (list.json().items as { id: string }[]).map((item) => item.id);
    check("列表包含草稿、已完成与发送中活动", [draftId, completedId, sendingId].every((id) => listed.includes(id)), listed);
    check("详情可读取已完成活动", (await api("GET", `/api/campaigns/${completedId}`)).statusCode === 200);

    const unsubscribed = await app.inject({ method: "POST", url: `/u/${tracking["alice@example.test"]}` });
    check("删除前通过原邮件退订", unsubscribed.statusCode === 200, unsubscribed.statusCode);
    const requeue = await api("POST", `/api/campaigns/${completedId}/messages/requeue-unknown`, {});
    const requeueToken = requeue.json().confirm_token as string | undefined;
    check("删除前取得 unknown 回收令牌", requeue.statusCode === 200 && !!requeueToken, requeue.statusCode);

    const sendingDelete = await api("DELETE", `/api/campaigns/${sendingId}`);
    check("发送中活动不能删除（409 INVALID_STATE）", sendingDelete.statusCode === 409 && sendingDelete.json().error?.code === "INVALID_STATE", sendingDelete.statusCode);
    check("草稿永久删除", (await api("DELETE", `/api/campaigns/${draftId}`)).statusCode === 200);
    check("已完成活动永久删除", (await api("DELETE", `/api/campaigns/${completedId}`)).statusCode === 200);
    const remaining = await db.select({ id: campaigns.id }).from(campaigns).where(sql`${campaigns.id} IN (${draftId}, ${completedId})`);
    check("数据库中已无被删除的活动", remaining.length === 0, remaining);
    const [orphans] = await db.select({ n: sql<number>`count(*)::int` }).from(messages).where(eq(messages.campaign_id, completedId));
    check("被删除活动的邮件一并删除", orphans?.n === 0, orphans?.n);
    const relisted = (await api("GET", "/api/campaigns?limit=100")).json().items as { id: string }[];
    check("列表不再包含被删除活动", !relisted.some((item) => item.id === draftId || item.id === completedId));
    check("被删除活动的详情返回 404", (await api("GET", `/api/campaigns/${completedId}`)).statusCode === 404);
    check("再次删除返回 404", (await api("DELETE", `/api/campaigns/${completedId}`)).statusCode === 404);
    check("删除后 unknown 回收返回 404",
      (await api("POST", `/api/campaigns/${completedId}/messages/requeue-unknown`, { confirm_token: requeueToken })).statusCode === 404);

    const [aliceAfter] = await db.select().from(contacts).where(eq(contacts.id, alice!.id));
    check("删除前已退订的联系人保持退订", aliceAfter?.status === "unsubscribed", aliceAfter?.status);
    check("已删除活动的原退订链接返回 404", (await app.inject({ method: "GET", url: `/u/${tracking["carol@example.test"]}` })).statusCode === 404);

    const bounce = await app.inject({
      method: "POST", url: "/webhooks/bounce", headers: { authorization: `Bearer ${config.MCP_TOKEN}` },
      payload: { type: "hard", source: "check", tracking_id: tracking["carol@example.test"], email: "carol@example.test" }
    });
    const [carolAfter] = await db.select().from(contacts).where(eq(contacts.id, carol!.id));
    check("原邮件已删除时 webhook 退信按邮箱生效", bounce.statusCode === 202 && carolAfter?.status === "bounced", { status: bounce.statusCode, contact: carolAfter?.status });

    const [channel] = await db.insert(channels).values({
      name: "check", config_enc: Buffer.alloc(1), from_email: "sender@example.test", from_name: "check", reply_to: "sender@example.test"
    }).returning({ id: channels.id });
    const dsn = [
      "From: Mail Delivery System <MAILER-DAEMON@example.test>", "To: sender@example.test", "Subject: Undelivered Mail Returned to Sender",
      "MIME-Version: 1.0", 'Content-Type: multipart/report; report-type=delivery-status; boundary="b"', "",
      "--b", "Content-Type: text/plain", "", "Delivery failed.", "",
      "--b", "Content-Type: message/delivery-status", "", "Reporting-MTA: dns; mx.example.test", "",
      "Final-Recipient: rfc822; dave@example.test", "Action: failed", "Status: 5.1.1", "Diagnostic-Code: smtp; 550 5.1.1 user unknown", "",
      "--b--", ""
    ].join("\r\n");
    const inbound = await processInboundMail(db, config, { channelId: channel!.id, uid: 1, uidValidity: 1, raw: dsn }, null);
    const [daveAfter] = await db.select().from(contacts).where(eq(contacts.id, dave!.id));
    check("原邮件已删除时 IMAP 退信按 DSN 收件人生效", daveAfter?.status === "bounced" && inbound.mail?.needs_review === false,
      { contact: daveAfter?.status, needs_review: inbound.mail?.needs_review });
  } finally {
    await app.close();
  }
} finally {
  await handle.close();
  await pg.stop();
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} 项未通过` : "\n活动删除检查全部通过");
process.exitCode = failures ? 1 : 0;
