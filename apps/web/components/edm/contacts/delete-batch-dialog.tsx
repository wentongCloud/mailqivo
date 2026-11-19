"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import type { ContactDeleteSummary } from "@mailqivo/shared";

import { ApiError } from "@/lib/api/client";
import { isDeleteChallenge, useDeleteContacts } from "@/lib/api/contacts";
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
type Props = {
  open: boolean;
  contactIds: string[];
  onClose: () => void;
  onDone?: () => void;
};

/** 点删除后直接打开核对对话框，确认后才删除。 */
export function DeleteBatchDialog({ open, contactIds, onClose, onDone }: Props) {
  if (!open) return null;
  return <Body key={contactIds.join(",")} contactIds={contactIds} onClose={onClose} onDone={onDone} />;
}

function Body({ contactIds, onClose, onDone }: Omit<Props, "open">) {
  const t = useTranslations("DeleteBatch");
  const tc = useTranslations("Common");
  const locale = useLocale();
  const mutation = useDeleteContacts();
  const [challenge, setChallenge] = React.useState<{ token: string; summary: ContactDeleteSummary } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const join = locale.startsWith("zh") ? "、" : ", ";

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await mutation.mutateAsync({ contact_ids: contactIds });
        if (!cancelled && isDeleteChallenge(res)) setChallenge({ token: res.confirm_token, summary: res.summary });
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : t("fail"));
      }
    })();
    return () => {
      cancelled = true;
    };
    // 打开时取一次摘要。mutation 身份每轮都会变，不能放进依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactIds]);

  async function confirm() {
    if (!challenge) return;
    setError(null);
    try {
      const res = await mutation.mutateAsync({ contact_ids: contactIds, confirm_token: challenge.token });
      if (!isDeleteChallenge(res)) {
        toast.success(t("done", { count: res.deleted }));
        onDone?.();
        onClose();
      }
    } catch (err) {
      if (err instanceof ApiError && err.body.code === "CONFIRM_INVALID") {
        const details = err.body.details as { summary?: ContactDeleteSummary; confirm_token?: string } | undefined;
        if (details?.summary && details.confirm_token) {
          setChallenge({ token: details.confirm_token, summary: details.summary });
          setNotice(tc("confirmAgain"));
          return;
        }
      }
      setChallenge(null);
      setError(err instanceof ApiError ? err.message : t("fail"));
    }
  }

  const sample = challenge?.summary.sample.join(join) ?? "";

  return (
    <AlertDialog open onOpenChange={(next) => !next && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("title")}</AlertDialogTitle>
          {sample ? <AlertDialogDescription>{t("sample", { emails: sample })}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        {notice && <p className="text-sm text-orange-600">{notice}</p>}
        {error && <p className="text-destructive text-sm">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={mutation.isPending || !challenge || challenge.summary.total === 0}
            onClick={(event) => {
              event.preventDefault();
              void confirm();
            }}
          >
            {mutation.isPending && challenge ? tc("processing") : t("confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
