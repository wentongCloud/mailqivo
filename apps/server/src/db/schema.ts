/**
 * Drizzle schema —— 与规格 §3 的权威 DDL 逐表、逐字段一致。
 *
 * 约定：
 * - TS 属性名与列名完全相同（snake_case），查询结果可直接对应 API 字段。
 * - 约束名与 PostgreSQL 执行 §3 DDL 时自动生成的名字一致：
 *   主键 `<表>_pkey`、唯一 `<表>_<列>_key`、外键 `<表>_<列>_fkey`、CHECK `<表>_<列>_check`。
 * - CHECK 中的取值来自 packages/shared/src/enums.ts（唯一出处）。
 * - 修改本文件后执行 `pnpm db:generate` 生成新迁移。
 */
import { sql, type SQL } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  customType,
  date,
  doublePrecision,
  foreignKey,
  index,
  inet,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";
import {
  BOUNCE_TYPE_VALUES,
  CAMPAIGN_STATUS_VALUES,
  CHANNEL_TYPE_VALUES,
  CONSENT_SOURCE_VALUES,
  CONTACT_SOURCE_VALUES,
  CONTACT_STATUS_VALUES,
  DEDUP_STRATEGY_VALUES,
  EDITOR_MODE_VALUES,
  IMPORT_BATCH_STATUS_VALUES,
  INBOUND_CATEGORY_VALUES,
  MATCH_METHOD_VALUES,
  MESSAGE_STATUS_VALUES,
  PAUSE_REASON_VALUES,
  REPLY_INTENT_VALUES,
  TEMPLATE_CATEGORY_VALUES,
  TRACKING_EVENT_TYPE_VALUES
} from "@mailqivo/shared";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  }
});

/** `<column> IN ('a','b',...)` —— 与 DDL 中 `CHECK (col IN (...))` 等价 */
function inList(column: string, values: readonly string[]): SQL {
  const list = values.map((v) => `'${v.replaceAll("'", "''")}'`).join(",");
  return sql.raw(`${column} IN (${list})`);
}

/** CHECK 约束，名字与 PG 对列级 CHECK 自动生成的名字一致 */
function checkIn(table: string, column: string, values: readonly string[]) {
  return check(`${table}_${column}_check`, inList(column, values));
}

const timestamptz = () => timestamp({ withTimezone: true });
const createdAt = () => timestamptz().notNull().defaultNow();
const emptyJsonObject = sql`'{}'`;
const emptyArray = sql`'{}'`;

// ---------------------------------------------------------------------------
// tables（顺序与 §3 相同）
// ---------------------------------------------------------------------------

export const importBatches = pgTable(
  "import_batches",
  {
    id: uuid().primaryKey().defaultRandom(),
    filename: text().notNull(),
    status: text().notNull().default("previewed"),
    field_mapping: jsonb().notNull(),
    dedup_strategy: text(),
    tag_ids: uuid().array().notNull().default(emptyArray), // 导入时统一打上的标签
    report: jsonb().notNull().default(emptyJsonObject), // 见 §7.1
    created_at: createdAt(),
    committed_at: timestamptz()
  },
  () => [
    checkIn("import_batches", "status", IMPORT_BATCH_STATUS_VALUES),
    checkIn("import_batches", "dedup_strategy", DEDUP_STRATEGY_VALUES)
  ]
);

export const importRows = pgTable(
  "import_rows",
  {
    batch_id: uuid().notNull(),
    row_no: integer().notNull(), // 批次内的预检记录序号
    source_row_no: integer(), // 映射前的解析行号；旧批次为空
    data: jsonb().notNull(), // 映射后的字段
    raw: jsonb().notNull(), // 原始行，用于“下载问题行”
    issues: text().array().notNull().default(emptyArray) // ImportIssue 枚举
  },
  (t) => [
    primaryKey({ name: "import_rows_pkey", columns: [t.batch_id, t.row_no] }),
    foreignKey({
      name: "import_rows_batch_id_fkey",
      columns: [t.batch_id],
      foreignColumns: [importBatches.id]
    }).onDelete("cascade")
  ]
);

export const contacts = pgTable(
  "contacts",
  {
    id: uuid().primaryKey().defaultRandom(),
    email: text().notNull(),
    name: text(),
    company: text(),
    title: text(),
    custom_fields: jsonb().notNull().default(emptyJsonObject), // { "<key>": string }
    status: text().notNull().default("active"),
    invalid_reason: text(), // ReasonCode 或 'SOFT_BOUNCE_REPEATED'
    domain_suspect: boolean().notNull().default(false), // MX 探测失败
    soft_bounce_streak: integer().notNull().default(0),
    bounce_count: integer().notNull().default(0),
    last_bounce_at: timestamptz(),
    unsubscribed_at: timestamptz(),
    source: text().notNull(),
    consent_at: timestamptz(), // V1.1：来源登记时间，建行时服务端写入，此后只读
    consent_source: text(), // V1.1：建行时写入，此后只读
    import_batch_id: uuid(),
    created_at: createdAt(),
    updated_at: createdAt()
  },
  (t) => [
    unique("contacts_email_key").on(t.email),
    checkIn("contacts", "status", CONTACT_STATUS_VALUES),
    checkIn("contacts", "source", CONTACT_SOURCE_VALUES),
    check("contacts_consent_source_check", sql`consent_source IS NULL OR ${inList("consent_source", CONSENT_SOURCE_VALUES)}`),
    foreignKey({
      name: "contacts_import_batch_id_fkey",
      columns: [t.import_batch_id],
      foreignColumns: [importBatches.id]
    }).onDelete("set null"),
    index("contacts_status_idx").on(t.status),
    index("contacts_domain_idx").on(sql`(split_part(email,'@',2))`)
  ]
);

export const tags = pgTable(
  "tags",
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull()
  },
  (t) => [unique("tags_name_key").on(t.name)]
);

export const contactTags = pgTable(
  "contact_tags",
  {
    contact_id: uuid(),
    tag_id: uuid()
  },
  (t) => [
    primaryKey({ name: "contact_tags_pkey", columns: [t.contact_id, t.tag_id] }),
    foreignKey({
      name: "contact_tags_contact_id_fkey",
      columns: [t.contact_id],
      foreignColumns: [contacts.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "contact_tags_tag_id_fkey",
      columns: [t.tag_id],
      foreignColumns: [tags.id]
    }).onDelete("cascade")
  ]
);

export const signatures = pgTable(
  "signatures",
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    html: text().notNull(),
    is_default: boolean().notNull().default(false),
    created_at: createdAt(),
    updated_at: createdAt()
  },
  (t) => [uniqueIndex("signatures_one_default").on(t.is_default).where(sql`is_default`)]
);

export const templates = pgTable(
  "templates",
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    category: text().notNull().default("other"),
    subject: text().notNull(),
    html: text().notNull(),
    editor_mode: text().notNull().default("rich"), // §11.3
    created_at: createdAt(),
    updated_at: createdAt()
  },
  () => [
    checkIn("templates", "category", TEMPLATE_CATEGORY_VALUES),
    checkIn("templates", "editor_mode", EDITOR_MODE_VALUES)
  ]
);

export const channels = pgTable(
  "channels",
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    type: text().notNull().default("smtp"), // 仅 smtp
    config_enc: bytea().notNull(), // AES-256-GCM(JSON)，见 §6.4
    from_email: text().notNull(),
    from_name: text().notNull(),
    reply_to: text().notNull(), // 必须是 IMAP 轮询的那个邮箱
    rate_per_minute: integer().notNull().default(30),
    /** 0 = 无日额度限制（商用发信通道）。 */
    daily_limit: integer().notNull().default(300),
    is_default: boolean().notNull().default(false),
    created_at: createdAt(),
    updated_at: createdAt()
  },
  (t) => [
    checkIn("channels", "type", CHANNEL_TYPE_VALUES),
    uniqueIndex("channels_one_default").on(t.is_default).where(sql`is_default`)
  ]
);

export const channelDailyUsage = pgTable(
  "channel_daily_usage",
  {
    channel_id: uuid(),
    day: date({ mode: "string" }).notNull(), // APP_TIMEZONE 下的日期
    count: integer().notNull().default(0)
  },
  (t) => [
    primaryKey({ name: "channel_daily_usage_pkey", columns: [t.channel_id, t.day] }),
    foreignKey({
      name: "channel_daily_usage_channel_id_fkey",
      columns: [t.channel_id],
      foreignColumns: [channels.id]
    }).onDelete("cascade")
  ]
);

/**
 * 跨进程共享的每分钟发送令牌桶（rate_per_minute）。多个 worker 进程共用，
 * 避免进程内限速在横向扩容时被放大 N 倍。
 */
export const channelRateBuckets = pgTable(
  "channel_rate_buckets",
  {
    channel_id: uuid().primaryKey(),
    tokens: doublePrecision().notNull(),
    updated_at: timestamptz().notNull()
  },
  (t) => [
    foreignKey({
      name: "channel_rate_buckets_channel_id_fkey",
      columns: [t.channel_id],
      foreignColumns: [channels.id]
    }).onDelete("cascade")
  ]
);

export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    subject: text().notNull(), // 可含变量
    html: text().notNull(), // 正文模板快照（已消毒）
    editor_mode: text().notNull().default("rich"), // §11.3
    template_id: uuid(),
    signature_id: uuid(),
    channel_id: uuid(),
    contact_filter: jsonb().notNull(), // §5.3
    ai_goal: text(), // 活动目标，供 LLM 使用
    ai_fields: text().array().notNull().default(emptyArray), // 允许 LLM 读取的联系人字段白名单
    ai_blocks: jsonb().notNull().default(sql`'[]'`), // [{ key, instruction, max_chars }]
    content_rules: jsonb().notNull().default(sql`'[]'`), // V1.1：有序 Tags 内容规则（§8.2），R3 实现逻辑
    track_opens: boolean().notNull().default(true),
    track_clicks: boolean().notNull().default(false),
    status: text().notNull().default("draft"),
    pause_reason: text(),
    fail_reason: text(),
    send_at: timestamptz(),
    started_at: timestamptz(),
    finished_at: timestamptz(),
    created_at: createdAt(),
    updated_at: createdAt()
  },
  (t) => [
    checkIn("campaigns", "editor_mode", EDITOR_MODE_VALUES),
    checkIn("campaigns", "status", CAMPAIGN_STATUS_VALUES),
    checkIn("campaigns", "pause_reason", PAUSE_REASON_VALUES),
    foreignKey({
      name: "campaigns_template_id_fkey",
      columns: [t.template_id],
      foreignColumns: [templates.id]
    }).onDelete("set null"),
    foreignKey({
      name: "campaigns_signature_id_fkey",
      columns: [t.signature_id],
      foreignColumns: [signatures.id]
    }).onDelete("set null"),
    foreignKey({
      name: "campaigns_channel_id_fkey",
      columns: [t.channel_id],
      foreignColumns: [channels.id]
    }),
    index("campaigns_status_idx").on(t.status)
  ]
);

/** 点击追踪用，渲染时生成 */
export const campaignLinks = pgTable(
  "campaign_links",
  {
    campaign_id: uuid(),
    idx: integer().notNull(),
    url: text().notNull()
  },
  (t) => [
    primaryKey({ name: "campaign_links_pkey", columns: [t.campaign_id, t.idx] }),
    foreignKey({
      name: "campaign_links_campaign_id_fkey",
      columns: [t.campaign_id],
      foreignColumns: [campaigns.id]
    }).onDelete("cascade")
  ]
);


export const aiCache = pgTable(
  "ai_cache",
  {
    campaign_id: uuid(),
    contact_id: uuid(),
    block_key: text().notNull(),
    instruction_hash: text().notNull(), // sha256(ai_goal + block instruction/max_chars + ai_fields + 命中规则 id/instruction/matched_tags)
    text: text().notNull(),
    created_at: createdAt()
  },
  (t) => [
    primaryKey({ name: "ai_cache_pkey", columns: [t.campaign_id, t.contact_id, t.block_key] }),
    foreignKey({
      name: "ai_cache_campaign_id_fkey",
      columns: [t.campaign_id],
      foreignColumns: [campaigns.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "ai_cache_contact_id_fkey",
      columns: [t.contact_id],
      foreignColumns: [contacts.id]
    }).onDelete("cascade"),
    index("ai_cache_contact_idx").on(t.contact_id)
  ]
);

export const messages = pgTable(
  "messages",
  {
    id: uuid().primaryKey().defaultRandom(),
    tracking_id: uuid().notNull().defaultRandom(), // 追踪、退订、Message-ID 均用它
    campaign_id: uuid().notNull(),
    contact_id: uuid(), // 试发为 NULL
    email: text().notNull(),
    is_test: boolean().notNull().default(false),
    status: text().notNull(),
    skip_reason: text(), // SkipReason 枚举
    ai_content: jsonb().notNull().default(emptyJsonObject), // { "<block_key>": "<text>" }
    click_targets: jsonb().$type<string[]>(), // NULL 表示历史邮件使用活动级链接快照
    rendered_vars: jsonb(), // 发送时实际使用的变量快照（可追溯）
    rendered_subject: text(),
    attempt: integer().notNull().default(0),
    prepare_failures: integer().notNull().default(0), // SMTP 交接前异常的累计次数（与 SMTP 重试的 attempt 分开计）
    next_attempt_at: timestamptz().notNull().defaultNow(),
    locked_at: timestamptz(),
    send_lease_id: uuid(),
    smtp_code: integer(),
    smtp_response: text(),
    failure_reason: text(), // ReasonCode
    sent_at: timestamptz(),
    bounce_type: text(),
    bounce_reason: text(), // ReasonCode
    bounced_at: timestamptz(),
    first_opened_at: timestamptz(),
    open_count: integer().notNull().default(0),
    open_suspect: boolean().notNull().default(false), // 所有打开均为疑似机器
    first_clicked_at: timestamptz(),
    replied_at: timestamptz(),
    auto_replied_at: timestamptz(),
    content_rule_snapshot: jsonb(), // V1.1：R3 实现逻辑
    attachment_snapshot: jsonb(), // V1.1：[{ asset_id, filename, mime_type, size_bytes, sha256 }]，R3 实现逻辑
    created_at: createdAt()
  },
  (t) => [
    unique("messages_tracking_id_key").on(t.tracking_id),
    unique("messages_campaign_id_contact_id_key").on(t.campaign_id, t.contact_id),
    checkIn("messages", "status", MESSAGE_STATUS_VALUES),
    checkIn("messages", "bounce_type", BOUNCE_TYPE_VALUES),
    foreignKey({
      name: "messages_campaign_id_fkey",
      columns: [t.campaign_id],
      foreignColumns: [campaigns.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "messages_contact_id_fkey",
      columns: [t.contact_id],
      foreignColumns: [contacts.id]
    }).onDelete("set null"),
    index("messages_claim_idx")
      .on(t.status, t.next_attempt_at)
      .where(sql.raw("status IN ('queued','pending_ai')")),
    index("messages_sending_locked_idx").on(t.locked_at).where(sql.raw("status = 'sending'")),
    index("messages_campaign_idx").on(t.campaign_id, t.status),
    // 回信按发件人匹配最近 30 天已发邮件（inbound/match.ts matchReply）
    index("messages_email_sent_idx").on(t.email, t.sent_at).where(sql.raw("status = 'sent'")),
    // 删除联系人时 ON DELETE SET NULL 需按 contact_id 查找
    index("messages_contact_idx").on(t.contact_id)
  ]
);

export const trackingEvents = pgTable(
  "tracking_events",
  {
    id: bigserial({ mode: "number" }).primaryKey(),
    message_id: uuid().notNull(),
    type: text().notNull(),
    link_idx: integer(),
    ts: timestamptz().notNull().defaultNow(),
    ip: inet(),
    ua: text(),
    suspected_machine: boolean().notNull().default(false)
  },
  (t) => [
    checkIn("tracking_events", "type", TRACKING_EVENT_TYPE_VALUES),
    foreignKey({
      name: "tracking_events_message_id_fkey",
      columns: [t.message_id],
      foreignColumns: [messages.id]
    }).onDelete("cascade"),
    index("tracking_events_msg_idx").on(t.message_id, t.type)
  ]
);

/** IMAP 收到的每一封信，先落库再分类 */
export const inboundMails = pgTable(
  "inbound_mails",
  {
    id: uuid().primaryKey().defaultRandom(),
    channel_id: uuid().notNull(),
    imap_uid: bigint({ mode: "number" }).notNull(),
    uid_validity: bigint({ mode: "number" }).notNull(),
    rfc_message_id: text(),
    from_email: text(),
    subject: text(),
    received_at: timestamptz().notNull(),
    category: text(),
    message_id: uuid(), // 匹配到的原发信
    match_method: text(),
    body_text: text(), // 截断至 20000 字符
    // 退信字段
    bounce_type: text(),
    reason_code: text(),
    dsn_status: text(), // 例 '5.1.1'
    diagnostic: text(),
    // 人工回复字段
    intent: text(),
    summary: text(),
    suggested_reply: text(),
    handled: boolean().notNull().default(false),
    needs_review: boolean().notNull().default(false), // 无法匹配或无法分类 → 人工队列
    created_at: createdAt()
  },
  (t) => [
    unique("inbound_mails_channel_id_uid_validity_imap_uid_key").on(
      t.channel_id,
      t.uid_validity,
      t.imap_uid
    ),
    checkIn("inbound_mails", "category", INBOUND_CATEGORY_VALUES),
    checkIn("inbound_mails", "match_method", MATCH_METHOD_VALUES),
    checkIn("inbound_mails", "bounce_type", BOUNCE_TYPE_VALUES),
    checkIn("inbound_mails", "intent", REPLY_INTENT_VALUES),
    foreignKey({
      name: "inbound_mails_channel_id_fkey",
      columns: [t.channel_id],
      foreignColumns: [channels.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbound_mails_message_id_fkey",
      columns: [t.message_id],
      foreignColumns: [messages.id]
    }).onDelete("set null"),
    index("inbound_category_idx").on(t.category, t.handled),
    index("inbound_mails_message_idx").on(t.message_id)
  ]
);

export const confirmTokens = pgTable("confirm_tokens", {
  token: text().primaryKey(), // 24 字节随机数的 base64url
  action: text().notNull(), // 'campaign_send' | 'campaign_cancel' | 'contact_status' | 'import_commit' | 'message_requeue_unknown'
  target: jsonb().notNull(), // 操作对象及参数
  summary_hash: text().notNull(), // 发放令牌时摘要的 sha256
  expires_at: timestamptz().notNull(),
  used_at: timestamptz()
});

/** V1.1：邮件附件资产（§3 / §6.3）。不可变：无 update 接口；enabled=false 只阻止新引用。 */
export const assets = pgTable("assets", {
  id: uuid().primaryKey().defaultRandom(),
  filename: text().notNull(), // 原始文件名，仅用于展示与 MIME
  storage_key: text().notNull().unique("assets_storage_key_key"), // ASSET_DIR 下相对路径：<id>.<ext>，服务端生成
  mime_type: text().notNull(),
  size_bytes: bigint({ mode: "number" }).notNull(),
  sha256: text().notNull(),
  enabled: boolean().notNull().default(true),
  created_at: createdAt()
});

/** 键值配置，键见 §5.5 */
export const settings = pgTable("settings", {
  key: text().primaryKey(),
  value: jsonb().notNull()
});
