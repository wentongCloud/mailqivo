"use client";

import * as React from "react";
import { CircleAlert, CircleCheck, CircleDashed, CircleX, Loader2, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { type UpdateStage, type UpdateSummary, type UpdateTaskStatus } from "@mailqivo/shared";
import { ApiError } from "@/lib/api/client";
import { isTaskActive, useConfirmUpdate, useUpdateCheck, useUpdateTask } from "@/lib/api/update";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Challenge<S> = { token: string; summary: S };

/** CONFIRM_INVALID 时取新的摘要与令牌（与发送确认同一处理）。 */
function renewedChallenge<S>(error: unknown): Challenge<S> | null {
  if (!(error instanceof ApiError) || error.body.code !== "CONFIRM_INVALID") return null;
  const details = error.body.details as { summary?: S; confirm_token?: string } | undefined;
  return details?.summary && details.confirm_token ? { token: details.confirm_token, summary: details.summary } : null;
}

export function UpdateManager() {
  const t = useTranslations("Update");
  const tc = useTranslations("Common");
  // 页面刷新或服务重启后，用 API 返回的 current_task / last_task 恢复显示；本页刚发起的任务优先。
  const [followed, setFollowed] = React.useState<string | null>(null);
  const [taskState, setTaskState] = React.useState<UpdateTaskStatus["state"] | undefined>(undefined);
  const check = useUpdateCheck(taskState);
  const taskId = followed ?? check.data?.current_task ?? check.data?.last_task ?? null;
  const task = useUpdateTask(taskId);
  if (task.data?.state !== taskState) setTaskState(task.data?.state);
  const active = isTaskActive(task.data) || (!!followed && !task.data);
  const confirm = useConfirmUpdate();
  const [challenge, setChallenge] = React.useState<Challenge<UpdateSummary> | null>(null);

  function follow(id: string) { setFollowed(id); }

  async function requestSummary() {
    try {
      const result = await confirm.mutateAsync(undefined);
      if ("confirm_token" in result) setChallenge({ token: result.confirm_token, summary: result.summary });
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : tc("failed"));
    }
  }

  async function startUpdate() {
    if (!challenge) return;
    try {
      const result = await confirm.mutateAsync(challenge.token);
      if ("task_id" in result) { setChallenge(null); follow(result.task_id); }
    } catch (error) {
      const renewed = renewedChallenge<UpdateSummary>(error);
      if (renewed) { setChallenge(renewed); toast.info(tc("confirmAgain")); return; }
      setChallenge(null);
      toast.error(error instanceof ApiError ? error.message : tc("failed"));
    }
  }

  const data = check.data;
  const canUpdate = !!data && !data.up_to_date && !data.blockers.length && !active;
  const noteLines: string[] = [];
  if (data) {
    if (!data.up_to_date && data.migrations.pending.length > 0) noteLines.push(t("hasMigrations"));
    if (data.migrations.unknown_records > 0) noteLines.push(t("unknownRecords", { count: data.migrations.unknown_records }));
    if (!data.up_to_date && data.sending_campaigns > 0) noteLines.push(t("sendingHint", { count: data.sending_campaigns }));
  }
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="space-y-1.5">
            <CardTitle>{t("title")}</CardTitle>
            <CardDescription>{t("description")}</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => void check.refetch()} disabled={check.isFetching || active}>
            <RefreshCw className={check.isFetching ? "animate-spin" : undefined} />{t("recheck")}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {!data && check.isError ? (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertTitle>{t("checkFailed")}</AlertTitle>
              <AlertDescription>{check.error instanceof ApiError ? check.error.message : tc("failed")}</AlertDescription>
            </Alert>
          ) : !data ? <Skeleton className="h-32" /> : (
            <>
              <Table>
                <TableHeader><TableRow><TableHead>{t("component")}</TableHead><TableHead>{t("installed")}</TableHead><TableHead>{t("candidate")}</TableHead></TableRow></TableHeader>
                <TableBody>
                  <TableRow><TableCell>{t("app")}</TableCell><TableCell>{data.app.installed ?? "—"}</TableCell><TableCell>{data.app.candidate ?? "—"}</TableCell></TableRow>
                  <TableRow>
                    <TableCell>{t("plugin")}</TableCell>
                    <TableCell>{data.plugin.installed ?? t("notInstalled")}{data.plugin.installed && !data.plugin.enabled && <Badge variant="outline" className="ml-2">{t("disabled")}</Badge>}</TableCell>
                    <TableCell>{data.plugin.candidate ?? "—"}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
              <div className="text-muted-foreground space-y-1 text-sm">
                <p>{t("sourceCommit", { commit: data.source.commit?.slice(0, 12) ?? "—" })}</p>
                <details>
                  <summary className="cursor-pointer">{t("sourceDetails")}</summary>
                  <p className="mt-1 break-all">{t("sourceDir", { dir: data.source.dir ?? "—" })}</p>
                </details>
              </div>
              {data.notices.length > 0 && (
                <Alert>
                  <CircleAlert />
                  <AlertTitle>{t("notices")}</AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc space-y-1 pl-4">
                      {data.notices.map((notice) => (
                        <li key={notice.code}>{t(`notice.${notice.code}`)}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}
              {data.blockers.length > 0 && (
                <Alert variant="destructive">
                  <CircleAlert />
                  <AlertTitle>{t("blocked")}</AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc space-y-1 pl-4">
                      {data.blockers.map((blocker) => (
                        <li key={blocker.code}>{t(`blocker.${blocker.code}`)}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}
              {data.up_to_date && !data.blockers.length && <p className="text-sm">{t("upToDate")}</p>}
              {noteLines.length > 0 && (
                <ul className="text-muted-foreground space-y-1 text-sm">
                  {noteLines.map((line, index) => <li key={index}>{line}</li>)}
                </ul>
              )}
              <Button onClick={() => void requestSummary()} disabled={!canUpdate || confirm.isPending}>
                {confirm.isPending && <Loader2 className="animate-spin" />}{t("upgrade")}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {taskId && <TaskCard task={task.data} reconnecting={task.isFetching && task.failureCount > 0 || task.isError} />}

      <AlertDialog open={!!challenge} onOpenChange={(open) => { if (!open) setChallenge(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              {challenge ? (
                <ul className="space-y-1 text-sm">
                  <li>{t("app")}: {challenge.summary.app.installed ?? "—"} → {challenge.summary.app.candidate}</li>
                  <li>{t("plugin")}: {challenge.summary.plugin.installed ?? t("notInstalled")} → {challenge.summary.plugin.candidate}</li>
                  <li>{t("sourceCommit", { commit: challenge.summary.source_commit?.slice(0, 12) ?? "—" })}</li>
                  <li>{t("files", challenge.summary.files)}</li>
                  <li>{challenge.summary.migrations.length ? t("migrations", { list: challenge.summary.migrations.join(", ") }) : t("noMigrations")}</li>
                  <li>{t("noRollback")}</li>
                  <li>{challenge.summary.files.added + challenge.summary.files.modified + challenge.summary.files.removed === 0
                    ? t("noDowntime")
                    : challenge.summary.estimated_downtime_sec != null
                      ? t("downtime", { seconds: challenge.summary.estimated_downtime_sec })
                      : t("downtimeUnknown")}</li>
                  {challenge.summary.sending_campaigns > 0 && <li>{t("sendingHint", { count: challenge.summary.sending_campaigns })}</li>}
                </ul>
              ) : <span />}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={confirm.isPending}>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction disabled={confirm.isPending} onClick={(event) => { event.preventDefault(); void startUpdate(); }}>{t("upgrade")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

type StepId = "backup" | "update" | "start" | "migrate" | "done";

/**
 * 页面五步按实现规格 §10.6 归组，阶段按 updater 的执行顺序归入步骤，进度因此不会回跳。
 * 安装日志、脚本名和命令输出留在任务文件里，不展示。
 */
const CORE_STEPS: { id: StepId; stages: UpdateStage[] }[] = [
  { id: "backup", stages: ["lock", "verify_candidate", "stop_services", "backup"] },
  { id: "update", stages: ["apply_files", "install", "build"] },
  // 规格「页面步骤」表：verify_running 在迁移之后执行，但校验运行中的服务，进度与失败都归「启动服务」。
  { id: "start", stages: ["start_services", "verify_running"] },
  { id: "migrate", stages: ["migrate"] },
  { id: "done", stages: ["plugin", "finish"] }
];

/** 失败所在步骤与进度共用 CORE_STEPS。finish 在任何失败时都记为 failed，只是汇总，不单独标记。 */
function failureStep(name: UpdateStage): StepId | null {
  if (name === "finish") return null;
  return CORE_STEPS.find((step) => step.stages.includes(name))?.id ?? null;
}

type RecordedStage = UpdateTaskStatus["stages"][number];

function stepStatus(
  step: (typeof CORE_STEPS)[number],
  recorded: ReadonlyMap<UpdateStage, RecordedStage>,
  taskStage: UpdateStage | null
): { current: boolean; result?: RecordedStage["result"] } {
  const current = step.stages.some((name) => taskStage === name);
  const failed = [...recorded.values()].some((stage) => stage.result === "failed" && failureStep(stage.name) === step.id);
  if (failed) return { current, result: "failed" };
  const finished = step.stages.flatMap((name) => {
    const stage = recorded.get(name);
    return stage && stage.result !== "failed" ? [stage] : [];
  });
  if (finished.length < step.stages.length) return { current };
  return { current, result: finished.some((stage) => stage.result === "ok") ? "ok" : "skipped" };
}

function StageIcon({ result, current }: { result?: "ok" | "skipped" | "failed"; current: boolean }) {
  if (current) return <Loader2 className="size-4 animate-spin" />;
  if (result === "ok") return <CircleCheck className="size-4 text-green-600" />;
  if (result === "failed") return <CircleX className="text-destructive size-4" />;
  return <CircleDashed className="text-muted-foreground size-4" />;
}

function TaskCard({ task, reconnecting }: { task?: UpdateTaskStatus; reconnecting: boolean }) {
  const t = useTranslations("Update");
  if (!task) return <Card><CardContent className="text-muted-foreground flex items-center gap-2 py-6 text-sm"><Loader2 className="size-4 animate-spin" />{t("reconnecting")}</CardContent></Card>;

  const results = new Map(task.stages.map((stage) => [stage.name, stage]));
  const warnings = task.warnings ?? [];
  // warnings 只来自插件阶段；有告警时插件可能不可用，不提示重启 Codex。
  const pluginUpdated = !warnings.length && task.plugin.now != null && task.plugin.now === task.plugin.target && task.plugin.before !== task.plugin.now;
  const active = isTaskActive(task);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">{t(`mode.${task.mode}`)}<Badge variant={task.state === "succeeded" ? "default" : task.state === "running" || task.state === "queued" ? "secondary" : "destructive"}>{t(`state.${task.state}`)}</Badge></CardTitle>
        {reconnecting && <CardDescription className="flex items-center gap-2"><Loader2 className="size-4 animate-spin" />{t("reconnecting")}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-4">
        <ol className="space-y-1.5">
          {CORE_STEPS.map((step) => {
            const { current, result } = stepStatus(step, results, task.stage);
            return (
              <li key={step.id} className="flex items-start gap-2 text-sm">
                <StageIcon result={result} current={current} />
                <span className={result === "skipped" ? "text-muted-foreground" : undefined}>{t(`step.${step.id}`)}</span>
              </li>
            );
          })}
        </ol>
        {!active && (
          <div className="space-y-2 text-sm">
            <p>{t("resultApp", { before: task.app.before ?? "—", target: task.app.target ?? "—", now: task.app.now ?? "—" })}</p>
            <p>{t("resultPlugin", { before: task.plugin.before ?? "—", target: task.plugin.target ?? "—", now: task.plugin.now ?? "—" })}</p>
            {task.downtime_sec != null && <p>{t("downtimeActual", { seconds: task.downtime_sec })}</p>}
            {task.state === "failed" && (
              <Alert variant="destructive">
                <CircleX />
                <AlertTitle>{t("stepFailed")}</AlertTitle>
                {task.error && <AlertDescription className="break-all whitespace-pre-wrap">{task.error}</AlertDescription>}
              </Alert>
            )}
            {warnings.length > 0 && (
              <Alert>
                <CircleAlert />
                <AlertTitle>{t("warnings")}</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc space-y-1 pl-4 break-all">{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
                </AlertDescription>
              </Alert>
            )}
            {pluginUpdated && <Alert><AlertDescription>{t("restartCodex")}</AlertDescription></Alert>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
