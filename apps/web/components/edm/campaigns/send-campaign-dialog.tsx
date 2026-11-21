"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { type CampaignSendSummary, type ContactStatus } from "@mailqivo/shared";
import { useLocalizedLabels } from "@/hooks/use-app-locale";
import { CalendarClock, Paperclip } from "lucide-react";
import { useSendCampaign } from "@/lib/api/campaigns";
import { ApiError } from "@/lib/api/client";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { RuleProblems, ruleProblemsOf } from "./rule-problems";

export function SendCampaignDialog({
  campaignId,
  open,
  onClose,
  schedule,
  scheduleChanged = false
}: {
  campaignId: string;
  open: boolean;
  onClose: () => void;
  schedule?: string;
  /** 本次打开前，过期的定时计划已改为立即发送（设计 §1 第 3 步）。 */
  scheduleChanged?: boolean;
}) {
  return (
    <AlertDialog open={open} onOpenChange={(value) => !value && onClose()}>
      <AlertDialogContent>
        {open && <Body campaignId={campaignId} onClose={onClose} schedule={schedule} scheduleChanged={scheduleChanged} />}
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * 设计 §1.2–§1.3：打开即请求摘要；确认时提交该摘要的令牌。
 * 令牌失效（CONFIRM_INVALID）不接收新令牌，清除旧摘要后由用户重新请求（规格 §5.4 第 2 条）。
 */
function Body({ campaignId, onClose, schedule, scheduleChanged }: { campaignId: string; onClose: () => void; schedule?: string; scheduleChanged: boolean }) {
  const t = useTranslations("SendDialog");
  const tc = useTranslations("Common");
  const locale = useLocale();
  const labels = useLocalizedLabels();
  const router = useRouter();
  const mutation = useSendCampaign(campaignId);
  const [challenge, setChallenge] = React.useState<{ token: string; summary: CampaignSendSummary } | null>(null);
  const [error, setError] = React.useState("");
  const [problems, setProblems] = React.useState<ReturnType<typeof ruleProblemsOf>>([]);
  const [notice, setNotice] = React.useState("");
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const effectiveSchedule = schedule && new Date(schedule).getTime() > Date.now() ? schedule : undefined;
  const body = { ...(effectiveSchedule ? { send_at: effectiveSchedule } : {}) };
  const scheduleLabel = effectiveSchedule
    ? new Date(effectiveSchedule).toLocaleString(locale, { hour12: false })
    : scheduleChanged || schedule
      ? t("immediateExpired")
      : t("immediate");

  async function requestSummary() {
    setError("");
    setProblems([]);
    try {
      const result = await mutation.mutateAsync(body);
      if ("requires_confirmation" in result) {
        setNotice("");
        setChallenge({ token: result.confirm_token, summary: result.summary });
      }
    } catch (err) {
      setProblems(ruleProblemsOf(err));
      setError(err instanceof ApiError ? err.message : t("validateFail"));
    }
  }

  // 打开时请求一次摘要；之后的重新请求由按钮触发。
  const requested = React.useRef(false);
  React.useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    void requestSummary();
  });

  async function confirm() {
    if (!challenge) return;
    setError("");
    try {
      const result = await mutation.mutateAsync({ ...body, confirm_token: challenge.token });
      if ("requires_confirmation" in result) return;
      if (result.status === "failed") toast.error(t("prepareFailed", { reason: result.fail_reason ?? "" }));
      else toast.success(result.status === "scheduled" ? t("scheduled") : t("queued"));
      onClose();
      router.push(result.status === "failed" ? `/campaigns/${result.id}` : "/campaigns");
    } catch (err) {
      setChallenge(null);
      if (err instanceof ApiError && err.body.code === "CONFIRM_INVALID") {
        setNotice(t("summaryStale"));
        return;
      }
      setError(err instanceof ApiError ? err.message : t("sendFail"));
    }
  }

  const skipList = !challenge
    ? ""
    : Object.entries(challenge.summary.skipped_by_status)
        .map(([key, count]) => `${labels.contactStatus[key as ContactStatus] ?? key} ${count}`)
        .join(locale.startsWith("zh") ? "、" : ", ") || t("noSkip");

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>{t("title")}</AlertDialogTitle>
        <AlertDialogDescription>{t("confirmDesc")}</AlertDialogDescription>
      </AlertDialogHeader>
      <div className="bg-muted/50 flex items-start gap-2 rounded-md p-3 text-sm">
        <CalendarClock className="mt-0.5 size-4 shrink-0" />
        <div>
          <div>
            {t.rich("schedule", {
              label: scheduleLabel,
              b: (chunks) => <b key="b">{chunks}</b>
            })}
          </div>
          <div className="text-muted-foreground mt-1 text-xs">{t("tzHint", { tz: timezone })}</div>
        </div>
      </div>
      {challenge && (
        <div className="bg-muted/50 space-y-2 rounded-md p-3 text-sm">
          <div>
            {t.rich("recipientsHtml", {
              count: challenge.summary.recipients,
              b: (chunks) => <b key="b">{chunks}</b>
            })}
          </div>
          <div>{t("skipped", { list: skipList })}</div>
          <div>
            {challenge.summary.channel_daily_remaining < 0
              ? `${t("dailyRemaining", { count: t("unlimited") })}`
              : t("dailyRemaining", { count: String(challenge.summary.channel_daily_remaining) })}
          </div>
          <div>{t("estimatedDays", { days: challenge.summary.estimated_days })}</div>
          {challenge.summary.ai_blocks.length > 0 && (
            <div>
              {t("aiBlocks", {
                list: challenge.summary.ai_blocks.join(locale.startsWith("zh") ? "、" : ", ")
              })}
            </div>
          )}
          {!challenge.summary.sample_confirmed && (
            <p className="text-destructive">
              {t("needSamples")}
              {challenge.summary.content_rules_breakdown.some((rule) => rule.recipients > 0 && !rule.has_sample)
                ? t("needRuleSamples")
                : ""}
            </p>
          )}
          {challenge.summary.large_audience_warning && (
            <p className="text-amber-600 dark:text-amber-400">{labels.common("largeAudienceWarning")}</p>
          )}
          <RulesBreakdown
            summary={challenge.summary}
            hasSample={(ruleId) =>
              challenge.summary.content_rules_breakdown.find((rule) => rule.rule_id === ruleId)?.has_sample ?? true
            }
          />
        </div>
      )}
      {!challenge && mutation.isPending && <p className="text-muted-foreground text-sm">{t("loading")}</p>}
      {notice && <p className="text-sm text-orange-600">{notice}</p>}
      {error && <p className="text-destructive text-sm">{error}</p>}
      <RuleProblems problems={problems} />
      <AlertDialogFooter>
        <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
        {challenge ? (
          <AlertDialogAction
            disabled={mutation.isPending || !challenge.summary.sample_confirmed || challenge.summary.recipients === 0}
            onClick={(event) => {
              event.preventDefault();
              void confirm();
            }}
          >
            {mutation.isPending ? t("processing") : t("confirmSend")}
          </AlertDialogAction>
        ) : (
          <Button disabled={mutation.isPending} onClick={() => void requestSummary()}>
            {mutation.isPending ? t("loading") : t("retry")}
          </Button>
        )}
      </AlertDialogFooter>
    </>
  );
}

/** §6.2 第 6 步 / §11.4：按规则展示命中人数与附件，以及未命中人数。 */
export function RulesBreakdown({
  summary,
  hasSample = () => true
}: {
  summary: CampaignSendSummary;
  hasSample?: (ruleId: string) => boolean;
}) {
  const t = useTranslations("SendDialog");
  const breakdown = summary.content_rules_breakdown ?? [];
  if (!breakdown.length) return null;
  return (
    <div className="space-y-1 border-t pt-2">
      <div className="font-medium">{t("rules")}</div>
      <ul className="space-y-1">
        {breakdown.map((rule) => {
          const missing = rule.recipients > 0 && !hasSample(rule.rule_id);
          return (
            <li key={rule.rule_id} className={missing ? "text-destructive" : undefined}>
              <div className="flex justify-between gap-2">
                <span className="truncate">
                  {rule.name}
                  {missing && t("noPreview")}
                </span>
                <span className="shrink-0">{t("people", { count: rule.recipients })}</span>
              </div>
              {rule.attachments.length > 0 && (
                <div className="text-muted-foreground flex flex-wrap gap-x-2 text-xs">
                  {rule.attachments.map((asset) => (
                    <span key={asset.asset_id} className="inline-flex items-center gap-1">
                      <Paperclip className="size-3" />
                      {asset.filename}
                    </span>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex justify-between">
        <span>{t("unmatched")}</span>
        <span>{t("people", { count: summary.unmatched_recipients })}</span>
      </div>
    </div>
  );
}
