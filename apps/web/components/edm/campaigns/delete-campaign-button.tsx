"use client";

import * as React from "react";
import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import type { CampaignDto } from "@mailqivo/shared";
import { useDeleteCampaign } from "@/lib/api/campaigns";
import { ApiError } from "@/lib/api/client";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

type Props = {
  campaign: Pick<CampaignDto, "id" | "name" | "status">;
  iconOnly?: boolean;
  onDeleted?: () => void;
};

export function DeleteCampaignButton({ campaign, iconOnly, onDeleted }: Props) {
  const t = useTranslations("Campaigns");
  const tc = useTranslations("Common");
  const remove = useDeleteCampaign();
  const [open, setOpen] = React.useState(false);
  if (campaign.status !== "draft" && campaign.status !== "completed") return null;

  async function confirm() {
    try {
      await remove.mutateAsync(campaign.id);
      toast.success(t("deleted"));
      setOpen(false);
      onDeleted?.();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : tc("deleteFailed"));
    }
  }

  return <AlertDialog open={open} onOpenChange={setOpen}>
    <AlertDialogTrigger asChild>
      <Button variant={iconOnly ? "ghost" : "outline"} size={iconOnly ? "icon-sm" : "default"} aria-label={`${tc("delete")} ${campaign.name}`}>
        <Trash2 />{!iconOnly && tc("delete")}
      </Button>
    </AlertDialogTrigger>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{t("deleteConfirmTitle")}</AlertDialogTitle>
        <AlertDialogDescription>{t(campaign.status === "completed" ? "deleteCompletedDesc" : "deleteConfirmDesc", { name: campaign.name })}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel disabled={remove.isPending}>{tc("cancel")}</AlertDialogCancel>
        <AlertDialogAction variant="destructive" disabled={remove.isPending} onClick={(event) => { event.preventDefault(); void confirm(); }}>{tc("confirm")}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
