"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Edit, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { SignatureBody, type SignatureDto } from "@mailqivo/shared";
import { signatureApi } from "@/lib/api/content";
import { ApiError } from "@/lib/api/client";
import { clearEditorDraft, EmailEditor } from "@/components/edm/email-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

export function SignatureManager() {
  const t = useTranslations("Signatures");
  const tc = useTranslations("Common");
  const { data: items = [], isLoading } = signatureApi.useList();
  const remove = signatureApi.useDelete();
  const [editing, setEditing] = React.useState<SignatureDto | "new" | null>(null);
  const [deleting, setDeleting] = React.useState<SignatureDto | null>(null);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription className="mt-1">{t("desc")}</CardDescription>
        </div>
        <Button onClick={() => setEditing("new")}>
          <Plus />
          {t("new")}
        </Button>
      </div>
      {isLoading ? (
        <Skeleton className="h-40" />
      ) : items.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t("empty")}</EmptyTitle>
            <EmptyDescription>{t("emptyDesc")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {items.map((item) => (
            <Card key={item.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{item.name}</CardTitle>
                  {item.is_default && <Badge>{tc("default")}</Badge>}
                </div>
              </CardHeader>
              <CardContent>
                <div
                  className="bg-muted/30 mb-3 line-clamp-3 rounded p-3 text-sm"
                  dangerouslySetInnerHTML={{ __html: item.html }}
                />
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="outline" onClick={() => setEditing(item)}>
                    <Edit />
                    {tc("edit")}
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`${tc("delete")} ${item.name}`}
                    onClick={() => setDeleting(item)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="flex w-[842px] max-w-[calc(100vw-2rem)]! flex-col gap-0 overflow-hidden p-0 sm:max-h-[min(640px,80vh)]">
          {editing && (
            <SignatureForm item={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteConfirmDesc", { name: deleting?.name ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                if (!deleting) return;
                try {
                  await remove.mutateAsync(deleting.id);
                  toast.success(t("deleted"));
                  setDeleting(null);
                } catch (err) {
                  toast.error(err instanceof ApiError ? err.message : tc("deleteFailed"));
                }
              }}
            >
              {tc("confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SignatureForm({ item, onClose }: { item: SignatureDto | null; onClose: () => void }) {
  const t = useTranslations("Signatures");
  const tc = useTranslations("Common");
  const create = signatureApi.useCreate();
  const update = signatureApi.useUpdate();
  const [editorMode, setEditorMode] = React.useState<"rich" | "html">("rich");
  const form = useForm<z.input<typeof SignatureBody>>({
    resolver: zodResolver(SignatureBody),
    defaultValues: item ?? { name: "", html: "<p></p>", is_default: false }
  });
  const autosaveKey = item ? `signature:${item.id}` : "signature:new";
  async function submit(values: z.input<typeof SignatureBody>) {
    try {
      const body = SignatureBody.parse(values);
      if (item) await update.mutateAsync({ id: item.id, body });
      else await create.mutateAsync(body);
      clearEditorDraft(autosaveKey);
      toast.success(t("saved"));
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : tc("saveFailed"));
    }
  }
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} className="contents">
        <div className="overflow-y-auto">
          <DialogHeader className="px-6 pt-6 text-left">
            <DialogTitle>{item ? t("edit") : t("new")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 p-6">
            <div className="grid grid-cols-[3fr_2fr] items-end gap-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("name")}</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="is_default"
                render={({ field }) => (
                  <FormItem className="flex h-8 items-center gap-2">
                    <FormControl>
                      <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                    <FormLabel className="mt-0!">{t("setDefault")}</FormLabel>
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="html"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("title")}</FormLabel>
                  <FormControl>
                    <EmailEditor
                      value={field.value}
                      onChange={field.onChange}
                      mode={editorMode}
                      onModeChange={setEditorMode}
                      toolbarVariant="signature"
                      autosaveKey={autosaveKey}
                      serverUpdatedAt={item?.updated_at}
                      onAutosave={
                        item
                          ? async ({ html }) => {
                              const body = SignatureBody.parse({ ...form.getValues(), html });
                              const saved = await update.mutateAsync({ id: item.id, body });
                              return { updated_at: saved.updated_at };
                            }
                          : undefined
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>
        <DialogFooter className="m-0 border-t px-6 py-4">
          <DialogClose asChild>
            <Button type="button" variant="outline" onClick={onClose}>
              {tc("cancel")}
            </Button>
          </DialogClose>
          <Button type="submit" disabled={create.isPending || update.isPending}>
            {tc("save")}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}
