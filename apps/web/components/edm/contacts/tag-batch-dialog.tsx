"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { ApiError } from "@/lib/api/client";
import { useApplyContactTags } from "@/lib/api/contacts";
import { useTags } from "@/lib/api/tags";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactIds: string[];
  onDone?: () => void;
};

/** 批量打标签 / 去标签：POST /api/contacts/tags */
export function TagBatchDialog({ open, onOpenChange, contactIds, onDone }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open && <Body contactIds={contactIds} onClose={() => onOpenChange(false)} onDone={onDone} />}
      </DialogContent>
    </Dialog>
  );
}

function Body({ contactIds, onClose, onDone }: { contactIds: string[]; onClose: () => void; onDone?: () => void }) {
  const t = useTranslations("Tags");
  const tc = useTranslations("Common");
  const { data: tags = [] } = useTags();
  const apply = useApplyContactTags();
  const [mode, setMode] = React.useState<"add" | "remove">("add");
  const [picked, setPicked] = React.useState<string[]>([]);
  const [draft, setDraft] = React.useState("");

  const toggle = (name: string) =>
    setPicked((p) => (p.includes(name) ? p.filter((n) => n !== name) : [...p, name]));

  function addDraft() {
    const names = draft.split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
    if (names.length === 0) return;
    setPicked((p) => [...new Set([...p, ...names])]);
    setDraft("");
  }

  async function submit() {
    const names = [...new Set([...picked, ...draft.split(/[,，、]/).map((s) => s.trim()).filter(Boolean)])];
    if (names.length === 0) return;
    try {
      const res = await apply.mutateAsync({
        contact_ids: contactIds,
        ...(mode === "add" ? { add: names } : { remove: names })
      });
      toast.success(mode === "add" ? t("batchAdd", { count: res.matched }) : t("batchRemove", { count: res.matched }));
      onDone?.();
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : tc("requestFailed"));
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("batchTitle")}</DialogTitle>
        <DialogDescription>{t("batchDesc", { count: contactIds.length })}</DialogDescription>
      </DialogHeader>

      <Tabs
        value={mode}
        onValueChange={(v) => {
          setMode(v as "add" | "remove");
          setPicked([]);
        }}>
        <TabsList>
          <TabsTrigger value="add">{t("addTab")}</TabsTrigger>
          <TabsTrigger value="remove">{t("removeTab")}</TabsTrigger>
        </TabsList>
      </Tabs>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <button type="button" key={t.id} onClick={() => toggle(t.name)}>
              <Badge variant={picked.includes(t.name) ? "default" : "outline"}>{t.name}</Badge>
            </button>
          ))}
        </div>
      )}

      {mode === "add" && (
        <div className="flex gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t("orType")}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addDraft();
              }
            }}
          />
          <Button type="button" variant="outline" onClick={addDraft}>
            {t("addDraft")}
          </Button>
        </div>
      )}

      {picked.length > 0 && (
        <p className="text-muted-foreground text-sm">
          {mode === "add" ? t("willAdd", { names: picked.join(", ") }) : t("willRemove", { names: picked.join(", ") })}
        </p>
      )}

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {tc("cancel")}
        </Button>
        <Button onClick={submit} disabled={apply.isPending || (picked.length === 0 && !draft.trim())}>
          {apply.isPending ? tc("processing") : tc("ok")}
        </Button>
      </DialogFooter>
    </>
  );
}
