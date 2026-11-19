"use client";

import * as React from "react";
import { useForm, type Control } from "react-hook-form";
import type { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { CircleAlert, Edit, Loader2, PlugZap, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ChannelBody, type ChannelDto, type ChannelVerifyResult } from "@mailqivo/shared";
import { useChannels, useCreateChannel, useDeleteChannel, useUpdateChannel, useVerifyChannel } from "@/lib/api/channels";
import { ApiError } from "@/lib/api/client";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";

import { channelFormSchema } from "./channel-form-schema";

type FormValues = z.input<typeof ChannelBody>;

export function ChannelManager() {
  const t = useTranslations("Channels");
  const tc = useTranslations("Common");
  const { data: items = [], isLoading } = useChannels();
  const remove = useDeleteChannel();
  const verify = useVerifyChannel();
  const [editing, setEditing] = React.useState<ChannelDto | "new" | null>(null);
  const [deleting, setDeleting] = React.useState<ChannelDto | null>(null);
  const [verified, setVerified] = React.useState<{ id: string; result: ChannelVerifyResult } | null>(null);

  async function testConnection(item: ChannelDto) {
    try {
      const result = await verify.mutateAsync(item.id);
      setVerified({ id: item.id, result });
      if (result.smtp && result.imap) toast.success(t("verifyOk"));
      else toast.error(result.error || t("verifyFail"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("verifyFail"));
    }
  }

  return (
    <div className="space-y-4">
      <Alert>
        <CircleAlert />
        <AlertTitle>{t("tipTitle")}</AlertTitle>
        <AlertDescription>{t("tipDesc")}</AlertDescription>
      </Alert>
      <div className="flex items-center justify-between gap-4">
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
        <Skeleton className="h-48" />
      ) : items.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t("empty")}</EmptyTitle>
            <EmptyDescription>{t("emptyDesc")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <Card key={item.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base">{item.name}</CardTitle>
                    {item.is_default && <Badge>{tc("default")}</Badge>}
                  </div>
                  <div className="flex flex-wrap justify-end gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={verify.isPending}
                      onClick={() => testConnection(item)}
                    >
                      {verify.isPending && verify.variables === item.id ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        <PlugZap />
                      )}
                      {t("test")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setVerified(null);
                        setEditing(item);
                      }}
                    >
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
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 text-sm sm:grid-cols-3">
                  <div>
                    <span className="text-muted-foreground">SMTP</span>
                    <p className="mt-1 font-mono text-xs">
                      {item.smtp.host}:{item.smtp.port}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">{t("rateLabel")}</span>
                    <p className="mt-1">{t("perMinute", { n: item.rate_per_minute })}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">{t("dailyLabel")}</span>
                    <p className="mt-1">
                      {item.daily_limit <= 0 ? t("unlimited") : item.daily_limit}
                    </p>
                  </div>
                </div>
                {verified?.id === item.id && (
                  <Alert variant={verified.result.smtp && verified.result.imap ? "default" : "destructive"}>
                    <AlertTitle>
                      {t("verifyTitle", {
                        smtp: verified.result.smtp ? t("ok") : t("fail"),
                        imap: verified.result.imap ? t("ok") : t("fail")
                      })}
                    </AlertTitle>
                    {verified.result.error && <AlertDescription>{verified.result.error}</AlertDescription>}
                  </Alert>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="flex w-[512px] max-w-[calc(100vw-2rem)]! flex-col gap-0 overflow-hidden p-0 sm:max-h-[min(640px,80vh)]">
          {editing && <ChannelForm item={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
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
              {t("confirmDelete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function defaults(item: ChannelDto | null): FormValues {
  if (item) return { ...item, smtp: { ...item.smtp, pass: "" }, imap: { ...item.imap, pass: "" } };
  return {
    name: "",
    type: "smtp",
    from_email: "",
    from_name: "",
    reply_to: "",
    rate_per_minute: 30,
    daily_limit: 300,
    is_default: false,
    smtp: { host: "", port: 465, secure: true, user: "", pass: "" },
    imap: { host: "", port: 993, secure: true, user: "", pass: "" }
  };
}

function ChannelForm({ item, onClose }: { item: ChannelDto | null; onClose: () => void }) {
  const t = useTranslations("Channels");
  const tc = useTranslations("Common");
  const create = useCreateChannel();
  const update = useUpdateChannel();
  const form = useForm<FormValues>({ resolver: zodResolver(channelFormSchema(item)), defaultValues: defaults(item) });

  async function submit(values: FormValues) {
    try {
      const body = ChannelBody.parse(values);
      if (item) await update.mutateAsync({ id: item.id, body });
      else await create.mutateAsync(body);
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
            <DialogTitle>{item ? t("edit") : t("create")}</DialogTitle>
            {item && <DialogDescription>{t("editDesc")}</DialogDescription>}
          </DialogHeader>
          <div className="space-y-6 p-6">
            <section className="space-y-4">
              <h3 className="text-sm font-medium">{t("basic")}</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="rate_per_minute"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("ratePerMinute")}</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value as number} type="number" min={1} />
                      </FormControl>
                      <p className="text-muted-foreground text-xs">{t("rateHint")}</p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="daily_limit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("dailyLimit")}</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value as number} type="number" min={0} />
                      </FormControl>
                      <p className="text-muted-foreground text-xs">{t("dailyHint")}</p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="is_default"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-2">
                    <FormControl>
                      <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                    <FormLabel className="mt-0!">{t("setDefault")}</FormLabel>
                  </FormItem>
                )}
              />
            </section>
            <ServerFields control={form.control} prefix="smtp" title={t("smtpTitle")} editing={!!item} />
            <ServerFields control={form.control} prefix="imap" title={t("imapTitle")} editing={!!item} />
          </div>
        </div>
        <DialogFooter className="m-0 border-t px-6 py-4">
          <DialogClose asChild>
            <Button type="button" variant="outline" onClick={onClose}>
              {tc("cancel")}
            </Button>
          </DialogClose>
          <Button type="submit" disabled={create.isPending || update.isPending}>
            {t("saveChannel")}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}

function ServerFields({
  control,
  prefix,
  title,
  editing
}: {
  control: Control<FormValues>;
  prefix: "smtp" | "imap";
  title: string;
  editing: boolean;
}) {
  const t = useTranslations("Channels");
  return (
    <section className="space-y-4 border-t pt-4">
      <h3 className="text-sm font-medium">{title}</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          control={control}
          name={`${prefix}.host`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("host")}</FormLabel>
              <FormControl>
                <Input {...field} placeholder={`${prefix}.company.com`} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name={`${prefix}.port`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("port")}</FormLabel>
              <FormControl>
                <Input {...field} value={field.value as number} type="number" min={1} max={65535} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name={`${prefix}.user`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{editing ? t("user") : t("mailboxAccount")}</FormLabel>
              <FormControl>
                <Input {...field} type={editing ? "text" : "email"} autoComplete="username" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name={`${prefix}.pass`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("pass")}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type="password"
                  autoComplete="new-password"
                  placeholder={editing ? t("passKeep") : t("passNew")}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
      <FormField
        control={control}
        name={`${prefix}.secure`}
        render={({ field }) => (
          <FormItem className="flex items-center gap-2">
            <FormControl>
              <Switch checked={field.value} onCheckedChange={field.onChange} />
            </FormControl>
            <FormLabel className="mt-0!">{t("secure")}</FormLabel>
          </FormItem>
        )}
      />
    </section>
  );
}
