"use client";

import * as React from "react";
import { useFieldArray, useWatch, type Control, type UseFormReturn } from "react-hook-form";
import type { z } from "zod";
import { AlertTriangle, Paperclip, Plus, Sparkles, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { type CampaignBody, type CampaignPreviewItem } from "@mailqivo/shared";
import { useLocalizedLabels } from "@/hooks/use-app-locale";
import { usePreviewCampaign } from "@/lib/api/campaigns";
import { ApiError } from "@/lib/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardDescription, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

type FormValues = z.input<typeof CampaignBody>;
type Form = UseFormReturn<FormValues>;

/** §8.2 白名单可选字段：内置字段；自定义字段可手动添加键名。 */
const BUILTIN_AI_FIELD_KEYS = ["name", "company", "title", "email"] as const;

/**
 * §11.4 右栏 AI 侧栏：活动目标、AI 区块（key / 指令 / 字数上限）、ai_fields 白名单、「生成样例」与预览卡片。
 * 生成样例前先保存草稿（预览读取的是服务端已保存的活动）。
 */
export function AiSidebar({ form, onSave }: { form: Form; onSave: (silent?: boolean) => Promise<string | null> }) {
  const t = useTranslations("AiSidebar");
  const blocks = useWatch({ control: form.control, name: "ai_blocks" }) ?? [];

  return (
    <div className="space-y-5 p-4">
      <div>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-4" />
          {t("title")}
        </CardTitle>
        <CardDescription className="mt-1">{t("desc")}</CardDescription>
      </div>
      <FormField
        control={form.control}
        name="ai_goal"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("goal")}</FormLabel>
            <FormControl>
              <Textarea
                {...field}
                value={field.value ?? ""}
                onChange={(event) =>
                  field.onChange(event.target.value === "" ? null : event.target.value)
                }
                rows={3}
                maxLength={4000}
                placeholder={t("goalPh")}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <BlocksEditor form={form} />
      <AiFieldsPicker form={form} />
      <Separator />
      {blocks.length ? <CampaignSamples form={form} onSave={onSave} /> : <p className="text-muted-foreground text-xs">{t("needBlock")}</p>}
    </div>
  );
}

export function CampaignSamples({ form, onSave }: { form: Form; onSave: (silent?: boolean) => Promise<string | null> }) {
  const t = useTranslations("AiSidebar");
  const preview = usePreviewCampaign();
  const [items, setItems] = React.useState<CampaignPreviewItem[]>([]);

  const rules = useWatch({ control: form.control, name: "content_rules" }) ?? [];
  const enabled = rules.filter((rule) => rule.enabled && rule.id);
  const [selected, setSelected] = React.useState("any");
  const ruleId = enabled.find((rule) => rule.id === selected)?.id;

  async function generate() {
    const id = await onSave(true);
    if (!id) {
      toast.error(t("saveDraftFirst"));
      return;
    }
    try {
      const result = await preview.mutateAsync({ id, body: { sample: 3, ...(ruleId ? { rule_id: ruleId } : {}) } });
      setItems(result);
      if (!result.length) toast.info(t("noActiveContacts"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("generateFail"));
    }
  }

  return (
    <>
      {enabled.length > 0 && (
        <Select value={ruleId ?? "any"} onValueChange={setSelected}>
          <SelectTrigger aria-label={t("sampleRule")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">{t("anySampleRule")}</SelectItem>
            {enabled.map((rule) => (
              <SelectItem key={rule.id} value={rule.id!}>{rule.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Button
        type="button"
        className="w-full"
        disabled={preview.isPending}
        onClick={generate}
      >
        <Sparkles />
        {preview.isPending ? t("generating") : t("generate")}
      </Button>
      {items.length > 0 && <PreviewCards items={items} />}
    </>
  );
}

function BlocksEditor({ form }: { form: Form }) {
  const t = useTranslations("AiSidebar");
  const control = form.control as Control<FormValues>;
  const { fields, append, remove } = useFieldArray({ control, name: "ai_blocks", keyName: "_key" });
  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">{t("blocks")}</p>
        <p className="text-muted-foreground text-xs">{t("blocksHint")}</p>
      </div>
      {fields.length === 0 && (
        <p className="text-muted-foreground rounded-md border border-dashed p-3 text-sm">
          {t("blocksEmpty")}
        </p>
      )}
      {fields.map((field, index) => (
        <div key={field._key} className="space-y-2 rounded-md border p-3">
          <div className="flex items-start gap-2">
            <FormField
              control={control}
              name={`ai_blocks.${index}.key`}
              render={({ field: item }) => (
                <FormItem className="flex-1">
                  <FormLabel className="text-xs">{t("key")}</FormLabel>
                  <FormControl>
                    <Input {...item} placeholder="intro" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={control}
              name={`ai_blocks.${index}.max_chars`}
              render={({ field: item }) => (
                <FormItem className="w-24">
                  <FormLabel className="text-xs">{t("maxChars")}</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      max={2000}
                      value={(item.value as number | string) ?? ""}
                      onChange={(event) =>
                        item.onChange(event.target.value === "" ? "" : Number(event.target.value))
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="mt-5"
              aria-label={t("deleteBlock")}
              onClick={() => remove(index)}
            >
              <Trash2 />
            </Button>
          </div>
          <FormField
            control={control}
            name={`ai_blocks.${index}.instruction`}
            render={({ field: item }) => (
              <FormItem>
                <FormLabel className="text-xs">{t("instruction")}</FormLabel>
                <FormControl>
                  <Textarea
                    {...item}
                    rows={2}
                    maxLength={2000}
                    placeholder={t("instructionPh")}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <p className="text-muted-foreground text-xs">
            {t("bodyRef")}{" "}
            <code>{`{{ai.${form.getValues(`ai_blocks.${index}.key`) || t("keyPlaceholder")}}}`}</code>
          </p>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full"
        disabled={fields.length >= 20}
        onClick={() =>
          append({ key: `block${fields.length + 1}`, instruction: "", max_chars: 200 })
        }
      >
        <Plus />
        {t("addBlock")}
      </Button>
    </div>
  );
}

function AiFieldsPicker({ form }: { form: Form }) {
  const t = useTranslations("AiSidebar");
  const [custom, setCustom] = React.useState("");
  const builtins = BUILTIN_AI_FIELD_KEYS.map((key) => ({
    key,
    label:
      key === "name"
        ? t("fieldName")
        : key === "company"
          ? t("fieldCompany")
          : key === "title"
            ? t("fieldTitle")
            : t("fieldEmail")
  }));
  return (
    <FormField
      control={form.control}
      name="ai_fields"
      render={({ field }) => {
        const value = field.value ?? [];
        const toggle = (key: string, checked: boolean) =>
          field.onChange(checked ? [...value, key] : value.filter((item) => item !== key));
        const extra = value.filter((key) => !BUILTIN_AI_FIELD_KEYS.includes(key as (typeof BUILTIN_AI_FIELD_KEYS)[number]));
        return (
          <FormItem>
            <FormLabel>{t("fields")}</FormLabel>
            <p className="text-muted-foreground text-xs">{t("fieldsHint")}</p>
            <div className="grid grid-cols-2 gap-2">
              {builtins.map((item) => (
                <label key={item.key} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={value.includes(item.key)}
                    onCheckedChange={(checked) => toggle(item.key, checked === true)}
                  />
                  {item.label}
                </label>
              ))}
            </div>
            {extra.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {extra.map((key) => (
                  <Badge
                    key={key}
                    variant="secondary"
                    className="cursor-pointer"
                    title={t("removeHint")}
                    onClick={() => toggle(key, false)}
                  >
                    {key} ×
                  </Badge>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Input
                value={custom}
                onChange={(event) => setCustom(event.target.value)}
                placeholder={t("customFieldPh")}
                className="h-8"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!custom.trim() || value.includes(custom.trim())}
                onClick={() => {
                  field.onChange([...value, custom.trim()]);
                  setCustom("");
                }}
              >
                {t("add")}
              </Button>
            </div>
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
}

function PreviewCards({ items }: { items: CampaignPreviewItem[] }) {
  const t = useTranslations("AiSidebar");
  return (
    <Tabs defaultValue={items[0]!.contact.id} className="w-full">
      <TabsList className="w-full">
        {items.map((item, index) => (
          <TabsTrigger key={item.contact.id} value={item.contact.id} className="truncate">
            {t("sampleN", { n: index + 1 })}
          </TabsTrigger>
        ))}
      </TabsList>
      {items.map((item) => (
        <TabsContent key={item.contact.id} value={item.contact.id}>
          <PreviewCard item={item} />
        </TabsContent>
      ))}
    </Tabs>
  );
}

function PreviewCard({ item }: { item: CampaignPreviewItem }) {
  const t = useTranslations("AiSidebar");
  const labels = useLocalizedLabels();
  return (
    <div className="space-y-3 rounded-md border p-3 text-sm">
      <div>
        <div className="font-medium">{item.contact.name || item.contact.email}</div>
        <div className="text-muted-foreground text-xs">
          {item.contact.email}
          {item.contact.company ? ` · ${item.contact.company}` : ""}
        </div>
      </div>
      <div className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-700 dark:bg-amber-950 dark:text-amber-300">
        {labels.common("aiPreviewNotice")}
      </div>
      <div className="space-y-1 text-xs">
        <div>
          <span className="text-muted-foreground">{t("hitRule")}</span>
          {item.content_rule ? item.content_rule.name : t("noRule")}
        </div>
        {item.matched_tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {item.matched_tags.map((tag) => (
              <Badge key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
          </div>
        )}
        {item.attachments.length > 0 && (
          <ul className="space-y-0.5">
            {item.attachments.map((file) => (
              <li key={file.asset_id} className="flex items-center gap-1">
                <Paperclip className="size-3" />
                {file.filename}
              </li>
            ))}
          </ul>
        )}
      </div>
      {item.warnings.length > 0 && (
        <ul className="space-y-1">
          {item.warnings.map((warning) => (
            <li key={warning} className="flex items-start gap-1 text-xs text-orange-600">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" />
              {warning}
            </li>
          ))}
        </ul>
      )}
      <div>
        <div className="text-muted-foreground text-xs">{t("subject")}</div>
        <div>{item.subject || "—"}</div>
      </div>
      {Object.entries(item.ai_content).map(([key, text]) => (
        <div key={key}>
          <div className="text-muted-foreground text-xs">ai.{key}</div>
          <p className="whitespace-pre-wrap">{text}</p>
        </div>
      ))}
      {item.html && (
        <iframe
          title={t("previewTitle", { email: item.contact.email })}
          sandbox=""
          srcDoc={item.html}
          className="h-64 w-full rounded border bg-white"
        />
      )}
    </div>
  );
}
