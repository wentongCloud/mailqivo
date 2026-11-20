"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { CONTACT_STATUS_VALUES, type ContactStatusSummary } from "@mailqivo/shared";
import { useLocalizedLabels } from "@/hooks/use-app-locale";
import { toast } from "sonner";

import { ApiError } from "@/lib/api/client";
import { isConfirmChallenge, useUpdateContactStatus } from "@/lib/api/contacts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type ManualStatus = "active" | "invalid" | "unsubscribed";

type Props = {
  /** 目标状态；为 null 时对话框关闭 */
  status: ManualStatus | null;
  contactIds: string[];
  onClose: () => void;
  onDone?: () => void;
};

/**
 * 批量改状态（§5.4 两步确认，AlertDialog）：
 * ① 填写原因 → ② 服务端返回摘要与令牌，用户核对 → ③ 带令牌确认执行。
 * 数据在确认前变化时（CONFIRM_INVALID），自动换成最新摘要与新令牌，请用户再次确认。
 */
export function StatusChangeDialog({ status, contactIds, onClose, onDone }: Props) {
  return (
    <AlertDialog open={status !== null} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        {status && <Body key={status} status={status} contactIds={contactIds} onClose={onClose} onDone={onDone} />}
      </AlertDialogContent>
    </AlertDialog>
  );
}

function Body({ status, contactIds, onClose, onDone }: Omit<Props, "status"> & { status: ManualStatus }) {
  const t = useTranslations("StatusDialog");
  const tc = useTranslations("Common");
  const locale = useLocale();
  const labels = useLocalizedLabels();
  const mutation = useUpdateContactStatus();
  const [reason, setReason] = React.useState("");
  const [challenge, setChallenge] = React.useState<{ token: string; summary: ContactStatusSummary } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const label = labels.contactStatus[status];
  const body = { contact_ids: contactIds, status, ...(reason.trim() ? { reason: reason.trim() } : {}) };
  const join = locale.startsWith("zh") ? "、" : ", ";

  async function requestSummary() {
    setError(null);
    try {
      const res = await mutation.mutateAsync(body);
      if (isConfirmChallenge(res)) setChallenge({ token: res.confirm_token, summary: res.summary });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("requestFail"));
    }
  }

  async function confirm() {
    if (!challenge) return;
    setError(null);
    try {
      const res = await mutation.mutateAsync({ ...body, confirm_token: challenge.token });
      if (!isConfirmChallenge(res)) {
        toast.success(t("done", { count: res.updated, status: label }));
        onDone?.();
        onClose();
      }
    } catch (err) {
      if (err instanceof ApiError && err.body.code === "CONFIRM_INVALID") {
        const d = err.body.details as { summary?: ContactStatusSummary; confirm_token?: string } | undefined;
        if (d?.summary && d.confirm_token) {
          setChallenge({ token: d.confirm_token, summary: d.summary });
          setNotice(tc("confirmAgain"));
          return;
        }
      }
      setChallenge(null);
      setError(err instanceof ApiError ? err.message : t("requestFail"));
    }
  }

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>{t("title", { count: contactIds.length, status: label })}</AlertDialogTitle>
        <AlertDialogDescription>{challenge ? t("review") : t("hint")}</AlertDialogDescription>
      </AlertDialogHeader>

      {!challenge && status !== "active" && (
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={200}
          placeholder={t("reasonOptional")}
          aria-label={t("reason")}
        />
      )}

      {challenge && (
        <div className="bg-muted/50 space-y-1 rounded-md p-3 text-sm">
          <div>
            {t.rich("summary", {
              change: challenge.summary.will_change,
              unchanged: challenge.summary.unchanged,
              status: label,
              b: (chunks) => <b key="b">{chunks}</b>
            })}
          </div>
          <div className="text-muted-foreground">
            {t("currentStatus")}
            {CONTACT_STATUS_VALUES.filter((s) => challenge.summary.by_current_status[s] > 0)
              .map((s) => `${labels.contactStatus[s]} ${challenge.summary.by_current_status[s]}`)
              .join(join)}
          </div>
          {challenge.summary.reason && (
            <div className="text-muted-foreground">{t("reasonLine", { reason: challenge.summary.reason })}</div>
          )}
        </div>
      )}
      {notice && <p className="text-sm text-orange-600">{notice}</p>}
      {error && <p className="text-destructive text-sm">{error}</p>}

      <AlertDialogFooter>
        <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
        {challenge ? (
          <AlertDialogAction
            variant={status === "active" ? "default" : "destructive"}
            disabled={mutation.isPending || challenge.summary.will_change === 0}
            onClick={(e) => {
              e.preventDefault();
              confirm();
            }}
          >
            {mutation.isPending ? tc("processing") : t("confirmChange")}
          </AlertDialogAction>
        ) : (
          <Button disabled={mutation.isPending} onClick={requestSummary}>
            {mutation.isPending ? t("calculating") : t("next")}
          </Button>
        )}
      </AlertDialogFooter>
    </>
  );
}
