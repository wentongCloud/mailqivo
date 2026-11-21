import type { UpdateBlocker, UpdateCheck, UpdateSummary, UpdateTaskStatus } from "@mailqivo/shared";

export declare const LABELS: { postgres: string; server: string; web: string; updater: string };
export declare const CURRENT_TASK_FILE: string;
export declare const UPDATER_FILES: string[];
export declare function isTaskId(id: unknown): id is string;
export declare function taskDir(runDir: string, id: string): string;
export declare function writeJsonAtomic(file: string, value: unknown): void;
export declare function readTaskStatus(runDir: string, id: string): UpdateTaskStatus | null;
export declare function isTaskAlive(status: UpdateTaskStatus): boolean;
export declare function effectiveTaskStatus(status: UpdateTaskStatus): UpdateTaskStatus;
export declare function currentTask(runDir: string): string | null;
export declare function releaseCurrentTask(runDir: string, id: string): void;
export declare function taskHistory(runDir: string): { last: string | null; downtime: number | null };

export type PluginState = { installed: string | null; enabled: boolean };
export declare function findCodex(): string | null;
export declare function pluginStatus(codexBin: string | null, timeoutMs?: number): Promise<PluginState>;

export type UpdatePlan = {
  commit: string;
  manifest: Record<string, string>;
  manifestSha256: string;
  localChanges: Record<string, string | null>;
  appUpdate: boolean;
  pluginUpdate: boolean;
  files: { added: string[]; modified: string[]; removed: string[] };
  migrations: string[];
};

export declare function computeCheck(input: {
  runDir: string;
  sourceDir: string | undefined;
  database: { recordedCreatedAt: number[]; preparing: number; sending: number };
  readPlugin?: () => Promise<PluginState>;
}): Promise<{ check: UpdateCheck & { blockers: UpdateBlocker[] }; plan: UpdatePlan | null }>;

export declare function updateSummary(check: UpdateCheck, plan: UpdatePlan): UpdateSummary;
