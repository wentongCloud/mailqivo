"use client";

import * as React from "react";
import { useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Edit, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { TEMPLATE_CATEGORY_VALUES, TemplateBody, type TemplateDto } from "@mailqivo/shared";
import { useLocalizedLabels } from "@/lib/use-app-locale";
import { templateApi } from "@/lib/api/content";
import { ApiError } from "@/lib/api/client";
import { clearEditorDraft, EmailEditor } from "@/components/edm/email-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

const empty: TemplateBody = { name: "", category: "other", subject: "", html: "<p>您好，{{姓名}}</p>", editor_mode: "rich" };

export function TemplateManager() {
  const t = useTranslations("Templates");
  const tc = useTranslations("Common");
  const labels = useLocalizedLabels();

  const { data: items = [], isLoading } = templateApi.useList();
  const remove = templateApi.useDelete();
  const [editing, setEditing] = React.useState<TemplateDto | "new" | null>(null);
  const [deleting, setDeleting] = React.useState<TemplateDto | null>(null);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between"><div><CardTitle>{t("title")}</CardTitle><CardDescription className="mt-1">{t("desc")}</CardDescription></div><Button onClick={() => setEditing("new")}><Plus />{t("new")}</Button></div>
      {isLoading ? <Skeleton className="h-48" /> : items.length === 0 ? <Empty><EmptyHeader><EmptyTitle>{t("empty")}</EmptyTitle><EmptyDescription>{t("emptyDesc")}</EmptyDescription></EmptyHeader></Empty> : <div className="grid gap-4 md:grid-cols-2">{items.map((item) => <Card key={item.id}><CardHeader><div className="flex items-start justify-between gap-2"><div><CardTitle className="text-base">{item.name}</CardTitle><CardDescription className="mt-1">{item.subject}</CardDescription></div><Badge variant="secondary">{labels.templateCategory[item.category]}</Badge></div></CardHeader><CardContent className="flex items-center justify-between"><span className="text-muted-foreground text-xs">{item.editor_mode === "rich" ? t("rich") : t("html")}</span><div className="flex gap-1"><Button size="sm" variant="outline" onClick={() => setEditing(item)}><Edit />{tc("edit")}</Button><Button size="icon-sm" variant="ghost" aria-label={`${tc("delete")} ${item.name}`} onClick={() => setDeleting(item)}><Trash2 /></Button></div></CardContent></Card>)}</div>}
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}><DialogContent className="flex w-[842px] max-w-[calc(100vw-2rem)]! flex-col gap-0 overflow-hidden p-0 sm:max-h-[min(640px,80vh)]">{editing && <TemplateForm item={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}</DialogContent></Dialog>
      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t("deleteConfirmTitle")}</AlertDialogTitle><AlertDialogDescription>{t("deleteConfirmDesc", { name: deleting?.name ?? "" })}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{tc("cancel")}</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={async () => { if (!deleting) return; try { await remove.mutateAsync(deleting.id); toast.success(t("deleted")); setDeleting(null); } catch (err) { toast.error(err instanceof ApiError ? err.message : tc("deleteFailed")); } }}>{tc("confirm")}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </div>
  );
}

function TemplateForm({ item, onClose }: { item: TemplateDto | null; onClose: () => void }) {
  const t = useTranslations("Templates");
  const tc = useTranslations("Common");
  const labels = useLocalizedLabels();
  const create = templateApi.useCreate();
  const update = templateApi.useUpdate();
  const form = useForm<z.input<typeof TemplateBody>>({ resolver: zodResolver(TemplateBody), defaultValues: item ?? empty });
  const editorMode = useWatch({ control: form.control, name: "editor_mode" }) ?? "rich";
  const pending = create.isPending || update.isPending;
  const autosaveKey = item ? `template:${item.id}` : "template:new";
  async function submit(values: z.input<typeof TemplateBody>) {
    try {
      const body = TemplateBody.parse(values);
      if (item) await update.mutateAsync({ id: item.id, body }); else await create.mutateAsync(body);
      clearEditorDraft(autosaveKey);
      toast.success(item ? t("updated") : t("created"));
      onClose();
    } catch (err) { toast.error(err instanceof ApiError ? err.message : tc("saveFailed")); }
  }
  return (
    <Form {...form}><form onSubmit={form.handleSubmit(submit)} className="contents"><div className="overflow-y-auto"><DialogHeader className="px-6 pt-6 text-left"><DialogTitle>{item ? t("edit") : t("new")}</DialogTitle><DialogDescription>{t("dialogDesc")}</DialogDescription></DialogHeader><div className="space-y-4 p-6">
        <div className="grid gap-4 sm:grid-cols-2"><FormField control={form.control} name="name" render={({ field }) => <FormItem><FormLabel>{t("name")}</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>} /><FormField control={form.control} name="category" render={({ field }) => <FormItem><FormLabel>{t("category")}</FormLabel><Select value={field.value} onValueChange={field.onChange}><FormControl><SelectTrigger className="w-full"><SelectValue /></SelectTrigger></FormControl><SelectContent>{TEMPLATE_CATEGORY_VALUES.map((value) => <SelectItem key={value} value={value}>{labels.templateCategory[value]}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>} /></div>
        <FormField control={form.control} name="subject" render={({ field }) => <FormItem><FormLabel>{t("subject")}</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>} />
        <FormField control={form.control} name="html" render={({ field }) => <FormItem><FormLabel>{t("body")}</FormLabel><FormControl><EmailEditor
          value={field.value}
          onChange={field.onChange}
          mode={editorMode}
          onModeChange={(mode) => form.setValue("editor_mode", mode)}
          autosaveKey={autosaveKey}
          serverUpdatedAt={item?.updated_at}
          onAutosave={item ? async ({ html, mode }) => {
            const body = TemplateBody.parse({ ...form.getValues(), html, editor_mode: mode });
            const saved = await update.mutateAsync({ id: item.id, body });
            return { updated_at: saved.updated_at };
          } : undefined}
        /></FormControl><FormMessage /></FormItem>} />
        </div></div><DialogFooter className="m-0 border-t px-6 py-4"><DialogClose asChild><Button type="button" variant="outline" onClick={onClose}>{tc("cancel")}</Button></DialogClose><Button type="submit" disabled={pending}>{pending ? tc("saving") : t("saveTemplate")}</Button></DialogFooter>
      </form></Form>
  );
}
