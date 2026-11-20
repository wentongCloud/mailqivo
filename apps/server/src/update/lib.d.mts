import type { UpdateBlocker, UpdateCheck, UpdateSummary, UpdateTaskStatus } from "@mailqivo/shared";

export declare const LABELS: { postgres: string; server: string; web: string; updater: string };
export declare const CURRENT_TASK_FILE: string;
export declare const UPDATER_FILES: string[];
export declare function isTaskId(id: unknown): id is string;
export declare function taskDir(runDir: string, id: string): string;
export declare function writeJsonAtomic(file: string, value: unknown): void;
export declare function readTaskStatus(runDir: string, id: string): UpdateTaskStatus | null;

export type UpdatePlan = {
  commit: string;
  manifest: Record<string, string>;
  manifestSha256: string;
  appUpdate: boolean;
  pluginUpdate: boolean;
  files: { added: string[]; modified: string[]; removed: string[] };
  migrations: string[];
};

export declare function computeCheck(input: {
  runDir: string;
  sourceDir: string | undefined;
  database: { recordedCreatedAt: number[]; preparing: number; sending: number };
  codexBin?: string | null;
  codexTimeoutMs?: number;
}): Promise<{ check: UpdateCheck & { blockers: UpdateBlocker[] }; plan: UpdatePlan | null }>;

export declare function updateSummary(check: UpdateCheck, plan: UpdatePlan): UpdateSummary;
