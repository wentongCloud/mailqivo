"use client";

import * as React from "react";
import { CheckIcon, PencilIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import type { TagDto } from "@mailqivo/shared";

import { ApiError } from "@/lib/api/client";
import { useCreateTag, useDeleteTag, useRenameTag, useTags } from "@/lib/api/tags";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

/** 标签管理：新建、重命名、删除（删除用 AlertDialog 二次确认）。 */
export function TagManagerDialog({
  open,
  onOpenChange
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("Tags");
  const tc = useTranslations("Common");
  const { data: tags, isLoading } = useTags();
  const create = useCreateTag();
  const rename = useRenameTag();
  const remove = useDeleteTag();
  const [newName, setNewName] = React.useState("");
  const [editing, setEditing] = React.useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = React.useState<TagDto | null>(null);

  function showRequestError(err: unknown) {
    toast.error(err instanceof ApiError ? err.message : tc("requestFailed"));
  }

  async function submitNew(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    try {
      await create.mutateAsync(name);
      setNewName("");
    } catch (err) {
      showRequestError(err);
    }
  }

  async function submitRename() {
    if (!editing) return;
    const name = editing.name.trim();
    if (!name) return;
    try {
      await rename.mutateAsync({ id: editing.id, name });
      setEditing(null);
    } catch (err) {
      showRequestError(err);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    try {
      await remove.mutateAsync(deleting.id);
      toast.success(t("deleted", { name: deleting.name }));
    } catch (err) {
      showRequestError(err);
    } finally {
      setDeleting(null);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("dialogTitle")}</DialogTitle>
            <DialogDescription>{t("dialogDesc")}</DialogDescription>
          </DialogHeader>

          <form onSubmit={submitNew} className="flex gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("newName")}
              maxLength={50}
            />
            <Button type="submit" disabled={create.isPending || !newName.trim()}>
              <PlusIcon /> {t("create")}
            </Button>
          </form>

          <div className="max-h-80 space-y-1 overflow-y-auto">
            {isLoading ? (
              <Skeleton className="h-9 w-full" />
            ) : !tags || tags.length === 0 ? (
              <Empty className="border">
                <EmptyHeader>
                  <EmptyTitle>{t("emptyTitle")}</EmptyTitle>
                  <EmptyDescription>{t("emptyDesc")}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              tags.map((tag) => (
                <div key={tag.id} className="hover:bg-muted/50 flex items-center gap-2 rounded-md px-2 py-1">
                  {editing?.id === tag.id ? (
                    <>
                      <Input
                        autoFocus
                        value={editing.name}
                        maxLength={50}
                        className="h-8"
                        onChange={(e) => setEditing({ id: tag.id, name: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") submitRename();
                          if (e.key === "Escape") setEditing(null);
                        }}
                      />
                      <Button size="icon-sm" variant="ghost" onClick={submitRename} aria-label={tc("save")}>
                        <CheckIcon />
                      </Button>
                      <Button size="icon-sm" variant="ghost" onClick={() => setEditing(null)} aria-label={tc("cancel")}>
                        <XIcon />
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{tag.name}</span>
                      <span className="text-muted-foreground text-xs tabular-nums">{t("people", { count: tag.contact_count })}</span>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t("rename", { name: tag.name })}
                        onClick={() => setEditing({ id: tag.id, name: tag.name })}>
                        <PencilIcon />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t("delete", { name: tag.name })}
                        onClick={() => setDeleting(tag)}>
                        <Trash2Icon />
                      </Button>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteTitle", { name: deleting?.name ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteDesc", { count: deleting?.contact_count ?? 0 })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmDelete}>
              {tc("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
