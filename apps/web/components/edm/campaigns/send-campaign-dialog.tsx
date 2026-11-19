"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { type CampaignSendSummary, type ContactStatus } from "@mailqivo/shared";
import { useLocalizedLabels } from "@/lib/use-app-locale";
import { CalendarClock, Paperclip } from "lucide-react";
import { useSendCampaign } from "@/lib/api/campaigns";
import { ApiError } from "@/lib/api/client";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export function SendCampaignDialog({ campaignId, open, onClose, schedule }: { campaignId: string; open: boolean; onClose: () => void; schedule?: string }) {
  return (
    <AlertDialog open={open} onOpenChange={(value) => !value && onClose()}>
      <AlertDialogContent>{open && <Body campaignId={campaignId} onClose={onClose} schedule={schedule} />}</AlertDialogContent>
    </AlertDialog>
  );
}

function Body({ campaignId, onClose, schedule }: { campaignId: string; onClose: () => void; schedule?: string }) {
  const t = useTranslations("SendDialog");
  const tc = useTranslations("Common");
  const locale = useLocale();
  const labels = useLocalizedLabels();
  const router = useRouter();
  const mutation = useSendCampaign(campaignId);
  const [challenge, setChallenge] = React.useState<{ token: string; summary: CampaignSendSummary } | null>(null);
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const effectiveSchedule = schedule && new Date(schedule).getTime() > Date.now() ? schedule : undefined;
  const scheduleExpired = Boolean(schedule && !effectiveSchedule);
  const body = { ...(effectiveSchedule ? { send_at: effectiveSchedule } : {}) };
  const scheduleLabel = effectiveSchedule
    ? new Date(effectiveSchedule).toLocaleString(locale, { hour12: false })
    : scheduleExpired
      ? t("immediateExpired")
      : t("immediate");

  async function requestSummary() {
    setError("");
    try {
      const result = await mutation.mutateAsync(body);
      if ("requires_confirmation" in result) setChallenge({ token: result.confirm_token, summary: result.summary });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("validateFail"));
    }
  }

  async function confirm() {
    if (!challenge) return;
    setError("");
    try {
      const result = await mutation.mutateAsync({ ...body, confirm_token: challenge.token });
      if (!("requires_confirmation" in result)) {
        toast.success(result.status === "scheduled" ? t("scheduled") : t("queued"));
        onClose();
        router.push("/campaigns");
      }
    } catch (err) {
      if (err instanceof ApiError && err.body.code === "CONFIRM_INVALID") {
        const details = err.body.details as { summary?: CampaignSendSummary; confirm_token?: string } | undefined;
        if (details?.summary && details.confirm_token) {
          setChallenge({ token: details.confirm_token, summary: details.summary });
          setNotice(tc("confirmAgain"));
          return;
        }
      }
      setChallenge(null);
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
        <AlertDialogTitle>{challenge ? t("title") : t("checkTitle")}</AlertDialogTitle>
        <AlertDialogDescription>{challenge ? t("confirmDesc") : t("checkDesc")}</AlertDialogDescription>
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
      {notice && <p className="text-sm text-orange-600">{notice}</p>}
      {error && <p className="text-destructive text-sm">{error}</p>}
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
            {mutation.isPending ? t("checking") : t("next")}
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
