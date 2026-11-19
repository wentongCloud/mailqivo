"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { ApiError } from "@/lib/api/client";
import { useUpdateContactLanguage } from "@/lib/api/contacts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LANGUAGE_OPTIONS } from "./contact-form-dialog";

const UNSET = "unset";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactIds: string[];
  onDone?: () => void;
};

/** 批量把语言偏好写成同一项。空选项会清除已有偏好。 */
export function LanguageBatchDialog({ open, onOpenChange, contactIds, onDone }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open && (
          <Body
            contactIds={contactIds}
            onClose={() => onOpenChange(false)}
            onDone={onDone}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Body({ contactIds, onClose, onDone }: { contactIds: string[]; onClose: () => void; onDone?: () => void }) {
  const t = useTranslations("LanguageBatch");
  const tc = useTranslations("Contacts");
  const common = useTranslations("Common");
  const mutation = useUpdateContactLanguage();
  const [choice, setChoice] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  async function save() {
    if (!choice) return;
    setError(null);
    try {
      const res = await mutation.mutateAsync({
        contact_ids: contactIds,
        language: choice === UNSET ? "" : (choice as (typeof LANGUAGE_OPTIONS)[number])
      });
      toast.success(t("done", { count: res.updated }));
      onDone?.();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("fail"));
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("title", { count: contactIds.length })}</DialogTitle>
        <DialogDescription>{t("hint")}</DialogDescription>
      </DialogHeader>
      <Select value={choice || undefined} onValueChange={setChoice}>
        <SelectTrigger className="w-full" aria-label={tc("language")}>
          <SelectValue placeholder={tc("languageUnset")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={UNSET}>{tc("languageUnset")}</SelectItem>
          {LANGUAGE_OPTIONS.map((language) => (
            <SelectItem key={language} value={language}>
              {language}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && <p className="text-destructive text-sm">{error}</p>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          {common("cancel")}
        </Button>
        <Button type="button" disabled={!choice || mutation.isPending} onClick={() => void save()}>
          {mutation.isPending ? common("processing") : common("save")}
        </Button>
      </DialogFooter>
    </>
  );
}
