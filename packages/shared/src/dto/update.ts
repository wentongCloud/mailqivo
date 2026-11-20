/** 版本更新（实现规格「版本更新」）：检查结果、确认摘要与更新任务状态。前后端与更新程序共用这些名称。 */
import { z } from "zod";

/** 更新程序的阶段，按执行顺序排列。 */
export const UPDATE_STAGE_VALUES = [
  "lock",
  "verify_candidate",
  "stop_services",
  "backup",
  "apply_files",
  "install",
  "build",
  "start_services",
  "migrate",
  "verify_running",
  "plugin",
  "finish"
] as const;
export type UpdateStage = (typeof UPDATE_STAGE_VALUES)[number];

/** 阻止更新的条件。 */
export const UPDATE_BLOCKER_VALUES = [
  "SOURCE_NOT_CONFIGURED",
  "SOURCE_INVALID",
  "SOURCE_UNCOMMITTED",
  "APP_DOWNGRADE",
  "MIGRATION_SKIPPED",
  "DATABASE_AHEAD",
  "LOCAL_CHANGES",
  "TASK_RUNNING",
  "CAMPAIGN_PREPARING"
] as const;
export type UpdateBlockerCode = (typeof UPDATE_BLOCKER_VALUES)[number];
export type UpdateBlocker = { code: UpdateBlockerCode; items?: string[] };

/** 不阻止更新、也不回退。更新完成后只记录。 */
export const UPDATE_NOTICE_VALUES = [
  "CODEX_UNAVAILABLE",
  "PLUGIN_DOWNGRADE",
  "PLUGIN_CONTENT_UNVERSIONED"
] as const;
export type UpdateNoticeCode = (typeof UPDATE_NOTICE_VALUES)[number];
export type UpdateNotice = { code: UpdateNoticeCode; items?: string[] };

export const UPDATE_TASK_MODE_VALUES = ["update"] as const;
export type UpdateTaskMode = (typeof UPDATE_TASK_MODE_VALUES)[number];

export const UPDATE_TASK_STATE_VALUES = ["queued", "running", "succeeded", "failed"] as const;
export type UpdateTaskState = (typeof UPDATE_TASK_STATE_VALUES)[number];

export type UpdateVersions = { installed: string | null; candidate: string | null };

export type UpdateCheck = {
  source: { dir: string | null; commit: string | null };
  app: UpdateVersions;
  plugin: UpdateVersions & { enabled: boolean };
  files: { added: string[]; modified: string[]; removed: string[] };
  migrations: { pending: string[]; unknown_records: number };
  sending_campaigns: number;
  /** 上次成功更新的停机秒数；没有记录时为 null。 */
  estimated_downtime_sec: number | null;
  blockers: UpdateBlocker[];
  /** 插件或 Codex 的情况。不阻止更新。 */
  notices: UpdateNotice[];
  up_to_date: boolean;
  current_task: string | null;
  last_task: string | null;
};

/** 两步确认的摘要；`manifest_sha256` 绑定候选文件，候选变化即摘要变化。 */
export type UpdateSummary = {
  app: UpdateVersions;
  plugin: UpdateVersions;
  source_commit: string | null;
  files: { added: number; modified: number; removed: number };
  migrations: string[];
  sending_campaigns: number;
  estimated_downtime_sec: number | null;
  manifest_sha256: string;
};

export const UpdateConfirmBody = z.object({ confirm_token: z.string().min(1).optional() }).strict();
export type UpdateConfirmBody = z.infer<typeof UpdateConfirmBody>;

export type UpdateTaskStatus = {
  id: string;
  mode: UpdateTaskMode;
  state: UpdateTaskState;
  created_at: string;
  finished_at: string | null;
  stage: UpdateStage | null;
  stages: { name: UpdateStage; result: "ok" | "skipped" | "failed"; detail?: string }[];
  app: { before: string | null; target: string | null; now: string | null };
  plugin: { before: string | null; target: string | null; now: string | null; enabled: boolean | null };
  downtime_sec: number | null;
  /**
   * 已停止服务并开始替换文件。此后进程退出也继续占着任务锁，
   * 下次启动更新程序只继续这一次，直到候选版本就绪。
   */
  forward: boolean;
  /** 就绪之后记录的非致命错误。不改变任务成败。 */
  warnings: string[];
  /** 更新程序进程 id；任务开始执行时写入，用于判断进程是否仍在运行。 */
  pid: number | null;
  error: string | null;
};
