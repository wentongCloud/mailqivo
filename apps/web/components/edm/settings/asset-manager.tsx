"use client";

import * as React from "react";
import { Ban, CircleAlert, Loader2, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ASSET_EXTENSIONS, AttachmentMaxTotalMb, type AssetDto } from "@mailqivo/shared";
import { useAssets, useDisableAsset, useUploadAsset } from "@/lib/api/assets";
import { ApiError } from "@/lib/api/client";
import { useSettings, usePatchSettings } from "@/lib/api/content";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function AssetManager() {
  const t = useTranslations("Assets");
  const tc = useTranslations("Common");
  const { data: items = [], isLoading } = useAssets();
  const upload = useUploadAsset();
  const disable = useDisableAsset();
  const [disabling, setDisabling] = React.useState<AssetDto | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const typeLabel: Record<string, string> = {
    "application/pdf": "PDF",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PowerPoint",
    "text/csv": "CSV",
    "text/plain": t("text"),
    "image/png": "PNG",
    "image/jpeg": "JPEG"
  };

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      await upload.mutateAsync(file);
      toast.success(t("uploaded", { name: file.name }));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("uploadFailed"));
    }
  }

  return (
    <div className="space-y-4">
      <Alert>
        <CircleAlert />
        <AlertTitle>{t("tipTitle")}</AlertTitle>
        <AlertDescription>{t("tipDesc", { ext: ASSET_EXTENSIONS.join(" / ") })}</AlertDescription>
      </Alert>
      <div className="flex items-center justify-between gap-4">
        <div>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription className="mt-1">{t("descShort")}</CardDescription>
        </div>
        <div>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept={ASSET_EXTENSIONS.map((ext) => `.${ext}`).join(",")}
            onChange={onFile}
          />
          <Button disabled={upload.isPending} onClick={() => inputRef.current?.click()}>
            {upload.isPending ? <Loader2 className="animate-spin" /> : <Upload />}
            {t("uploadBtn")}
          </Button>
        </div>
      </div>
      <SizeLimit />
      {isLoading ? (
        <Skeleton className="h-48" />
      ) : items.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t("empty")}</EmptyTitle>
            <EmptyDescription>{t("emptyDesc")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card className="py-0">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("filename")}</TableHead>
                  <TableHead>{t("type")}</TableHead>
                  <TableHead>{t("size")}</TableHead>
                  <TableHead>{t("sha")}</TableHead>
                  <TableHead>{t("status")}</TableHead>
                  <TableHead className="text-right">{tc("actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="max-w-64 truncate font-medium" title={item.filename}>
                      {item.filename}
                    </TableCell>
                    <TableCell>{typeLabel[item.mime_type] ?? item.mime_type}</TableCell>
                    <TableCell>{formatBytes(item.size_bytes)}</TableCell>
                    <TableCell className="font-mono text-xs" title={item.sha256}>
                      {item.sha256.slice(0, 8)}
                    </TableCell>
                    <TableCell>
                      {item.enabled ? <Badge>{t("enabled")}</Badge> : <Badge variant="secondary">{t("disabledBadge")}</Badge>}
                    </TableCell>
                    <TableCell className="text-right">
                      {item.enabled && (
                        <Button size="sm" variant="outline" onClick={() => setDisabling(item)}>
                          <Ban />
                          {t("disable")}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      <AlertDialog open={disabling !== null} onOpenChange={(open) => !open && setDisabling(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("disableConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("disableConfirmDesc", { name: disabling?.filename ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                if (!disabling) return;
                try {
                  await disable.mutateAsync(disabling.id);
                  toast.success(t("disabled"));
                  setDisabling(null);
                } catch (err) {
                  toast.error(err instanceof ApiError ? err.message : t("disableFailed"));
                }
              }}
            >
              {t("confirmDisable")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SizeLimit() {
  const t = useTranslations("Assets");
  const tc = useTranslations("Common");
  const { data } = useSettings();
  const update = usePatchSettings();
  const [text, setText] = React.useState<string | null>(null);
  if (!data) return <Skeleton className="h-24" />;
  const value = text ?? String(data.attachment_max_total_mb);
  const parsed = AttachmentMaxTotalMb.safeParse(value.trim() === "" ? Number.NaN : Number(value));
  async function save() {
    if (!parsed.success) return;
    try {
      await update.mutateAsync({ attachment_max_total_mb: parsed.data });
      setText(null);
      toast.success(t("limitSaved"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : tc("saveFailed"));
    }
  }
  return (
    <Card>
      <CardContent className="space-y-2">
        <Label htmlFor="attachment-max-mb">{t("limitLabel")}</Label>
        <div className="flex gap-2">
          <Input
            id="attachment-max-mb"
            className="max-w-32"
            type="number"
            inputMode="numeric"
            min={1}
            max={20}
            step={1}
            value={value}
            onChange={(event) => setText(event.target.value)}
          />
          <Button
            variant="outline"
            disabled={!parsed.success || update.isPending || value === String(data.attachment_max_total_mb)}
            onClick={save}
          >
            {tc("save")}
          </Button>
        </div>
        <p className={`text-sm ${parsed.success ? "text-muted-foreground" : "text-destructive"}`}>
          {parsed.success ? t("limitHintOk") : t("limitHintBad")}
        </p>
      </CardContent>
    </Card>
  );
}
