"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import type { CampaignTestSendResult } from "@mailqivo/shared";
import { useTestSendCampaign } from "@/lib/api/campaigns";
import { ApiError } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function TestSendDialog({
  campaignId,
  open,
  onClose
}: {
  campaignId: string;
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("TestSend");
  const mutation = useTestSendCampaign(campaignId);
  const [value, setValue] = React.useState("");
  const [results, setResults] = React.useState<CampaignTestSendResult["items"]>([]);
  const [error, setError] = React.useState("");

  async function submit() {
    setError("");
    const emails = [
      ...new Set(
        value
          .split(/[\s,，;；]+/)
          .map((item) => item.trim())
          .filter(Boolean)
      )
    ];
    if (!emails.length || emails.length > 5) {
      setError(t("emailsHint"));
      return;
    }
    try {
      const result = await mutation.mutateAsync({ emails });
      setResults(result.items);
      if (result.items.every((item) => item.ok)) toast.success(t("done"));
      else toast.error(t("partialFail"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("fail"));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("desc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="test-emails">{t("emails")}</Label>
          <Textarea
            id="test-emails"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={"you@example.com\ncolleague@example.com"}
            rows={4}
          />
        </div>
        {error && <p className="text-destructive text-sm">{error}</p>}
        {results.length > 0 && (
          <div className="space-y-1 rounded-md border p-3 text-sm">
            {results.map((item) => (
              <div key={item.id} className="flex justify-between gap-3">
                <span className="truncate">{item.email}</span>
                <span className={item.ok ? "text-green-600" : "text-destructive"}>
                  {item.ok ? t("success") : item.response}
                </span>
              </div>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("close")}
          </Button>
          <Button disabled={mutation.isPending} onClick={submit}>
            {mutation.isPending ? t("sending") : t("start")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
