/** 版本更新（实现规格「版本更新」）：检查结果、确认摘要与更新任务状态。前后端与更新程序共用这些名称。 */
import { z } from "zod";

/** 更新程序的阶段，按执行顺序排列。 */
export const UPDATE_STAGE_VALUES = [
  "lock",
  "verify_candidate",
  "backup_files",
  "stop_services",
  "backup_database",
  "apply_files",
  "install",
  "build",
  "migrate",
  "start_services",
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
  "CODEX_UNAVAILABLE",
  "APP_DOWNGRADE",
  "PLUGIN_DOWNGRADE",
  "PLUGIN_CONTENT_UNVERSIONED",
  "MIGRATION_SKIPPED",
  "DATABASE_AHEAD",
  "LOCAL_CHANGES",
  "TASK_RUNNING",
  "CAMPAIGN_PREPARING"
] as const;
export type UpdateBlockerCode = (typeof UPDATE_BLOCKER_VALUES)[number];
export type UpdateBlocker = { code: UpdateBlockerCode; items?: string[] };

export const UPDATE_TASK_MODE_VALUES = ["update", "plugin", "rollback"] as const;
export type UpdateTaskMode = (typeof UPDATE_TASK_MODE_VALUES)[number];

export const UPDATE_TASK_STATE_VALUES = ["queued", "running", "succeeded", "rolled_back", "partial", "failed"] as const;
export type UpdateTaskState = (typeof UPDATE_TASK_STATE_VALUES)[number];

export type UpdateVersions = { installed: string | null; candidate: string | null };

export type UpdateCheck = {
  source: { dir: string | null; commit: string | null };
  app: UpdateVersions;
  plugin: UpdateVersions & { enabled: boolean };
  files: { added: string[]; modified: string[]; removed: string[] };
  migrations: { pending: string[]; unknown_records: number };
  backup_database: boolean;
  sending_campaigns: number;
  /** 上次成功更新的停机秒数；没有记录时为 null。 */
  estimated_downtime_sec: number | null;
  blockers: UpdateBlocker[];
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
  backup_database: boolean;
  sending_campaigns: number;
  estimated_downtime_sec: number | null;
  manifest_sha256: string;
};

export const UpdateConfirmBody = z.object({ confirm_token: z.string().min(1).optional() }).strict();
export type UpdateConfirmBody = z.infer<typeof UpdateConfirmBody>;

/** 有数据库备份的任务（本次执行过迁移）回滚时必须同时恢复数据库，由服务端决定，不接受请求参数。 */
export const UpdateRollbackBody = z.object({ confirm_token: z.string().min(1).optional() }).strict();
export type UpdateRollbackBody = z.infer<typeof UpdateRollbackBody>;

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
  /** 只在任务产生备份时出现，路径相对运行目录。 */
  backup_dir: string | null;
  database_backed_up: boolean;
  /** 更新程序进程 id；任务开始执行时写入，用于判断进程是否仍在运行。 */
  pid: number | null;
  error: string | null;
};
