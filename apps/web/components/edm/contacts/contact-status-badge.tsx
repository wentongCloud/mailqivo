"use client";

import { format } from "date-fns";
import { useTranslations } from "next-intl";
import { invalidReasonLabelI18n, type ContactDto, type ContactStatus } from "@mailqivo/shared";

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLocalizedLabels } from "@/hooks/use-app-locale";

/** §11.5：active 成功色，invalid / bounced 为 destructive，unsubscribed 为 secondary。 */
export const STATUS_BADGE_VARIANT: Record<ContactStatus, "success" | "destructive" | "secondary"> = {
  active: "success",
  invalid: "destructive",
  bounced: "destructive",
  unsubscribed: "secondary"
};

/** 状态 Badge：无效 / 退信 / 退订悬停显示原因。 */
export function ContactStatusBadge({
  contact
}: {
  contact: Pick<ContactDto, "status" | "invalid_reason" | "unsubscribed_at" | "last_bounce_at">;
}) {
  const t = useTranslations("ContactStatus");
  const { locale, dateLocale, contactStatus } = useLocalizedLabels();
  const badge = (
    <Badge variant={STATUS_BADGE_VARIANT[contact.status]}>{contactStatus[contact.status]}</Badge>
  );
  if (contact.status === "active") return badge;

  const lines: string[] = [];
  const reason = invalidReasonLabelI18n(contact.invalid_reason, locale);
  const fallback =
    contact.status === "unsubscribed" ? t("unsubscribed") : t("notRecorded");
  lines.push(t("reason", { value: reason || fallback }));
  const when = contact.status === "unsubscribed" ? contact.unsubscribed_at : contact.last_bounce_at;
  if (when) {
    lines.push(t("time", { value: format(new Date(when), "yyyy-MM-dd HH:mm", { locale: dateLocale }) }));
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex cursor-default">{badge}</span>
      </TooltipTrigger>
      <TooltipContent>
        {lines.map((line) => (
          <div key={line}>{line}</div>
        ))}
      </TooltipContent>
    </Tooltip>
  );
}
