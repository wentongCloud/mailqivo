"use client";

import * as React from "react";
import { CircleAlert, CircleCheck, CircleDashed, CircleX, Loader2, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { UPDATE_STAGE_VALUES, type UpdateSummary, type UpdateTaskStatus } from "@mailqivo/shared";
import { ApiError } from "@/lib/api/client";
import {
  isTaskActive, useConfirmUpdate, useRetryPlugin, useRollbackUpdate, useUpdateCheck, useUpdateTask, type RollbackSummary
} from "@/lib/api/update";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
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
          {!data ? <Skeleton className="h-32" /> : (
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
              <p className="text-muted-foreground text-sm">{t("source", { dir: data.source.dir ?? "—", commit: data.source.commit?.slice(0, 12) ?? "—" })}</p>
              {data.blockers.length > 0 && (
                <Alert variant="destructive">
                  <CircleAlert />
                  <AlertTitle>{t("blocked")}</AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc space-y-1 pl-4">
                      {data.blockers.map((blocker) => (
                        <li key={blocker.code}>{t(`blocker.${blocker.code}`)}{blocker.items?.length ? `: ${blocker.items.slice(0, 8).join(", ")}${blocker.items.length > 8 ? " …" : ""}` : ""}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}
              {data.up_to_date && !data.blockers.length && <p className="text-sm">{t("upToDate")}</p>}
              {!data.up_to_date && (
                <ul className="text-muted-foreground space-y-1 text-sm">
                  <li>{t("files", { added: data.files.added.length, modified: data.files.modified.length, removed: data.files.removed.length })}</li>
                  <li>{data.migrations.pending.length ? t("migrations", { list: data.migrations.pending.join(", ") }) : t("noMigrations")}</li>
                  {data.migrations.unknown_records > 0 && <li>{t("unknownRecords", { count: data.migrations.unknown_records })}</li>}
                  {data.sending_campaigns > 0 && <li>{t("sendingHint", { count: data.sending_campaigns })}</li>}
                </ul>
              )}
              <Button onClick={() => void requestSummary()} disabled={!canUpdate || confirm.isPending}>
                {confirm.isPending && <Loader2 className="animate-spin" />}{t("upgrade")}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {taskId && <TaskCard task={task.data} reconnecting={task.isFetching && task.failureCount > 0 || task.isError} onFollow={follow} />}

      <AlertDialog open={!!challenge} onOpenChange={(open) => { if (!open) setChallenge(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              {challenge ? (
                <ul className="space-y-1 text-sm">
                  <li>{t("app")}: {challenge.summary.app.installed ?? "—"} → {challenge.summary.app.candidate}</li>
                  <li>{t("plugin")}: {challenge.summary.plugin.installed ?? t("notInstalled")} → {challenge.summary.plugin.candidate}</li>
                  <li>{t("files", challenge.summary.files)}</li>
                  <li>{challenge.summary.migrations.length ? t("migrations", { list: challenge.summary.migrations.join(", ") }) : t("noMigrations")}</li>
                  <li>{challenge.summary.backup_database ? t("backupDatabase") : t("noBackupDatabase")}</li>
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

function StageIcon({ result, current }: { result?: "ok" | "skipped" | "failed"; current: boolean }) {
  if (current) return <Loader2 className="size-4 animate-spin" />;
  if (result === "ok") return <CircleCheck className="size-4 text-green-600" />;
  if (result === "failed") return <CircleX className="text-destructive size-4" />;
  return <CircleDashed className="text-muted-foreground size-4" />;
}

function TaskCard({ task, reconnecting, onFollow }: { task?: UpdateTaskStatus; reconnecting: boolean; onFollow: (id: string) => void }) {
  const t = useTranslations("Update");
  const tc = useTranslations("Common");
  const retry = useRetryPlugin();
  const rollback = useRollbackUpdate();
  const [rollbackOpen, setRollbackOpen] = React.useState(false);
  const [restoreDatabase, setRestoreDatabase] = React.useState(false);
  const [rollbackChallenge, setRollbackChallenge] = React.useState<Challenge<RollbackSummary> | null>(null);
  if (!task) return <Card><CardContent className="text-muted-foreground flex items-center gap-2 py-6 text-sm"><Loader2 className="size-4 animate-spin" />{t("reconnecting")}</CardContent></Card>;

  const results = new Map(task.stages.map((stage) => [stage.name, stage]));
  const pluginFailed = results.get("plugin")?.result === "failed";
  const pluginDone = results.get("plugin")?.result === "ok";

  async function retryPlugin() {
    try { onFollow((await retry.mutateAsync(task!.id)).task_id); } catch (error) { toast.error(error instanceof ApiError ? error.message : tc("failed")); }
  }
  async function confirmRollback() {
    try {
      const result = await rollback.mutateAsync({ id: task!.id, restore_database: restoreDatabase, confirm_token: rollbackChallenge?.token });
      if ("confirm_token" in result) { setRollbackChallenge({ token: result.confirm_token, summary: result.summary }); return; }
      setRollbackOpen(false); setRollbackChallenge(null); onFollow(result.task_id);
    } catch (error) {
      const renewed = renewedChallenge<RollbackSummary>(error);
      if (renewed) { setRollbackChallenge(renewed); toast.info(tc("confirmAgain")); return; }
      toast.error(error instanceof ApiError ? error.message : tc("failed"));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">{t(`mode.${task.mode}`)}<Badge variant={task.state === "succeeded" ? "default" : task.state === "running" || task.state === "queued" ? "secondary" : "destructive"}>{t(`state.${task.state}`)}</Badge></CardTitle>
        {reconnecting && <CardDescription className="flex items-center gap-2"><Loader2 className="size-4 animate-spin" />{t("reconnecting")}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-4">
        <ol className="space-y-1.5">
          {UPDATE_STAGE_VALUES.map((name) => {
            const stage = results.get(name);
            return (
              <li key={name} className="flex items-start gap-2 text-sm">
                <StageIcon result={stage?.result} current={task.stage === name} />
                <span className={stage?.result === "skipped" ? "text-muted-foreground line-through" : undefined}>{t(`stage.${name}`)}</span>
                {stage?.detail && <span className="text-muted-foreground">— {stage.detail}</span>}
              </li>
            );
          })}
        </ol>
        {!isTaskActive(task) && (
          <div className="space-y-2 text-sm">
            <p>{t("resultApp", { before: task.app.before ?? "—", target: task.app.target ?? "—", now: task.app.now ?? "—" })}</p>
            <p>{t("resultPlugin", { before: task.plugin.before ?? "—", target: task.plugin.target ?? "—", now: task.plugin.now ?? "—" })}</p>
            {task.downtime_sec != null && <p>{t("downtimeActual", { seconds: task.downtime_sec })}</p>}
            {task.error && <p className="text-destructive">{task.error}</p>}
            {pluginDone && <Alert><AlertDescription>{t("restartCodex")}</AlertDescription></Alert>}
            <div className="flex flex-wrap gap-2">
              {task.state === "partial" && pluginFailed && <Button variant="outline" onClick={() => void retryPlugin()} disabled={retry.isPending}>{t("retryPlugin")}</Button>}
              {task.state === "partial" && task.backup_dir && <Button variant="outline" onClick={() => setRollbackOpen(true)}>{t("rollback")}</Button>}
            </div>
          </div>
        )}
      </CardContent>
      <AlertDialog open={rollbackOpen} onOpenChange={(open) => { setRollbackOpen(open); if (!open) setRollbackChallenge(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("rollbackTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("rollbackDesc", { version: task.app.before ?? "—" })}</AlertDialogDescription>
          </AlertDialogHeader>
          {task.database_backed_up && (
            <div className="flex items-start gap-2">
              <Checkbox id="restore-database" checked={restoreDatabase} disabled={!!rollbackChallenge} onCheckedChange={(value) => setRestoreDatabase(value === true)} />
              <Label htmlFor="restore-database" className="leading-snug">{t("restoreDatabase")}</Label>
            </div>
          )}
          {rollbackChallenge?.summary.may_resend && <Alert variant="destructive"><CircleAlert /><AlertDescription>{t("mayResend")}</AlertDescription></Alert>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rollback.isPending}>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={rollback.isPending} onClick={(event) => { event.preventDefault(); void confirmRollback(); }}>
              {rollbackChallenge ? tc("confirm") : t("rollback")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
