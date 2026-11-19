"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { SettingsBody } from "@mailqivo/shared";
import { useSettings, usePatchSettings } from "@/lib/api/content";
import { ApiError } from "@/lib/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

const contentChecks = SettingsBody.pick({ sensitive_words: true, prepare_warn_recipient_threshold: true });
type ContentChecks = Pick<SettingsBody, "sensitive_words" | "prepare_warn_recipient_threshold">;

export function ComplianceSettings() {
  const { data, isLoading } = useSettings();
  if (isLoading || !data) return <Skeleton className="h-96" />;
  const { sensitive_words, prepare_warn_recipient_threshold } = data;
  const initial = { sensitive_words, prepare_warn_recipient_threshold };
  return <ComplianceForm key={JSON.stringify(initial)} initial={initial} />;
}

function ComplianceForm({ initial }: { initial: ContentChecks }) {
  const t = useTranslations("Compliance");
  const tc = useTranslations("Common");
  const mutation = usePatchSettings();
  const form = useForm<ContentChecks>({ resolver: zodResolver(contentChecks), defaultValues: initial });
  const { dirtyFields, isDirty } = form.formState;
  async function submit(body: ContentChecks) {
    try {
      await mutation.mutateAsync({
        ...(dirtyFields.sensitive_words && { sensitive_words: body.sensitive_words }),
        ...(dirtyFields.prepare_warn_recipient_threshold && { prepare_warn_recipient_threshold: body.prepare_warn_recipient_threshold })
      });
      toast.success(t("saved"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : tc("saveFailed"));
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(submit)} className="space-y-6">
            <FormField
              control={form.control}
              name="sensitive_words"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("sensitiveWords")}</FormLabel>
                  <FormControl>
                    <TagInput values={field.value} onChange={field.onChange} />
                  </FormControl>
                  <FormDescription>{t("sensitiveHint")}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="prepare_warn_recipient_threshold"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("largeAudience")}</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={10000000}
                      step={1}
                      value={Number.isNaN(field.value) ? "" : field.value}
                      onChange={(event) => field.onChange(toNumber(event.target.value))}
                    />
                  </FormControl>
                  <FormDescription>{t("largeAudienceHint")}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" disabled={!isDirty || mutation.isPending}>
              {mutation.isPending ? tc("saving") : t("saveSettings")}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

const toNumber = (value: string) => (value.trim() === "" ? Number.NaN : Number(value));

function TagInput({ values, onChange }: { values: string[]; onChange: (values: string[]) => void }) {
  const t = useTranslations("Compliance");
  const tc = useTranslations("Common");
  const [text, setText] = React.useState("");
  function add() {
    const value = text.trim();
    if (value && !values.includes(value)) onChange([...values, value]);
    setText("");
  }
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={t("sensitivePlaceholder")}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
        />
        <Button type="button" variant="outline" onClick={add}>
          {tc("add")}
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {values.map((value) => (
          <Badge key={value} variant="secondary">
            {value}
            <button
              type="button"
              aria-label={`${tc("delete")} ${value}`}
              onClick={() => onChange(values.filter((item) => item !== value))}
            >
              <X className="size-3" />
            </button>
          </Badge>
        ))}
      </div>
    </div>
  );
}
