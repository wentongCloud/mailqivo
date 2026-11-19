"use client";

import * as React from "react";
import { useFieldArray, useWatch, type Control, type UseFormReturn } from "react-hook-form";
import type { z } from "zod";
import { ArrowDown, ArrowUp, ChevronsUpDown, Paperclip, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { CONTENT_RULE_LIMITS, type CampaignBody } from "@mailqivo/shared";
import { useAssets } from "@/lib/api/assets";
import { useTags } from "@/lib/api/tags";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

type FormValues = z.input<typeof CampaignBody>;
type Form = UseFormReturn<FormValues>;

/**
 * §11.4 左栏「内容规则」（V1.1）：Tags 组合只能从已有标签选择；附件只列启用资产；
 * 保存校验（重复集合 / priority / 回退、有指令无 AI 区块等）由服务端返回 VALIDATION。
 */
export function ContentRulesEditor({ form }: { form: Form }) {
  const t = useTranslations("ContentRules");
  const { fields, append, remove, move } = useFieldArray({
    control: form.control,
    name: "content_rules",
    keyName: "_key"
  });
  const rules = useWatch({ control: form.control, name: "content_rules" }) ?? [];
  const nextPriority = () =>
    rules.length ? Math.max(...rules.map((rule) => Number(rule?.priority ?? 0))) + 10 : 10;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">{t("title")}</p>
          <p className="text-muted-foreground text-xs">{t("desc")}</p>
        </div>
      </div>
      {fields.length === 0 && (
        <p className="text-muted-foreground rounded-md border border-dashed p-3 text-sm">{t("empty")}</p>
      )}
      {fields.map((field, index) => (
        <RuleCard
          key={field._key}
          form={form}
          index={index}
          count={fields.length}
          onRemove={() => remove(index)}
          onMove={(to) => move(index, to)}
        />
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full"
        disabled={fields.length >= CONTENT_RULE_LIMITS.rules}
        onClick={() =>
          append({
            name: t("ruleN", { n: fields.length + 1 }),
            tags_all: [],
            instruction: "",
            attachment_ids: [],
            priority: nextPriority(),
            enabled: true
          })
        }
      >
        <Plus />
        {t("add")}
      </Button>
    </div>
  );
}

function RuleCard({
  form,
  index,
  count,
  onRemove,
  onMove
}: {
  form: Form;
  index: number;
  count: number;
  onRemove: () => void;
  onMove: (to: number) => void;
}) {
  const t = useTranslations("ContentRules");
  const control = form.control as Control<FormValues>;
  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex items-center gap-2">
        <FormField
          control={control}
          name={`content_rules.${index}.name`}
          render={({ field }) => (
            <FormItem className="flex-1">
              <FormControl>
                <Input {...field} aria-label={t("ruleName")} placeholder={t("ruleName")} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name={`content_rules.${index}.enabled`}
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <Switch
                  aria-label={t("enable")}
                  checked={field.value ?? true}
                  onCheckedChange={field.onChange}
                />
              </FormControl>
            </FormItem>
          )}
        />
      </div>
      <FormField
        control={control}
        name={`content_rules.${index}.tags_all`}
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-xs">{t("tags")}</FormLabel>
            <TagSetPicker value={field.value ?? []} onChange={field.onChange} />
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={control}
        name={`content_rules.${index}.instruction`}
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-xs">{t("instruction")}</FormLabel>
            <FormControl>
              <Textarea
                {...field}
                value={field.value ?? ""}
                rows={3}
                maxLength={CONTENT_RULE_LIMITS.instruction}
                placeholder={t("instructionPh")}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={control}
        name={`content_rules.${index}.attachment_ids`}
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-xs">
              {t("attachments", { max: CONTENT_RULE_LIMITS.attachments })}
            </FormLabel>
            <AttachmentPicker value={field.value ?? []} onChange={field.onChange} />
            <FormMessage />
          </FormItem>
        )}
      />
      <div className="flex items-end gap-2">
        <FormField
          control={control}
          name={`content_rules.${index}.priority`}
          render={({ field }) => (
            <FormItem className="w-28">
              <FormLabel className="text-xs">{t("priority")}</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  step={1}
                  value={(field.value as number | string) ?? ""}
                  onChange={(event) =>
                    field.onChange(event.target.value === "" ? "" : Number(event.target.value))
                  }
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="ml-auto flex gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("moveUp")}
            disabled={index === 0}
            onClick={() => onMove(index - 1)}
          >
            <ArrowUp />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("moveDown")}
            disabled={index === count - 1}
            onClick={() => onMove(index + 1)}
          >
            <ArrowDown />
          </Button>
          <Button type="button" variant="ghost" size="icon" aria-label={t("removeRule")} onClick={onRemove}>
            <Trash2 />
          </Button>
        </div>
      </div>
    </div>
  );
}

/** 只能从已有标签中选择；已不存在的标签保留显示并标红，便于删除。 */
function TagSetPicker({ value, onChange }: { value: string[]; onChange: (value: string[]) => void }) {
  const t = useTranslations("ContentRules");
  const { data: tags = [] } = useTags();
  const names = new Set(tags.map((tag) => tag.name));
  const [query, setQuery] = React.useState("");
  const visible = tags.filter((tag) => tag.name.includes(query.trim()));
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {value.length ? (
          value.map((name) => (
            <Badge
              key={name}
              variant={names.has(name) ? "secondary" : "destructive"}
              className="cursor-pointer"
              title={t("removeHint")}
              onClick={() => onChange(value.filter((item) => item !== name))}
            >
              {name}
              {!names.has(name) && t("missing")} ×
            </Badge>
          ))
        ) : (
          <span className="text-muted-foreground text-xs">{t("fallback")}</span>
        )}
      </div>
      <Popover>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="w-full justify-between">
            {t("pickTags")}
            <ChevronsUpDown className="opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-2" align="start">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("searchTags")}
            className="mb-2 h-8"
          />
          <div className="max-h-56 space-y-1 overflow-y-auto">
            {visible.length ? (
              visible.map((tag) => (
                <label
                  key={tag.id}
                  className="hover:bg-muted flex items-center gap-2 rounded px-1 py-1 text-sm"
                >
                  <Checkbox
                    checked={value.includes(tag.name)}
                    disabled={!value.includes(tag.name) && value.length >= CONTENT_RULE_LIMITS.tags_all}
                    onCheckedChange={(checked) =>
                      onChange(
                        checked
                          ? [...value, tag.name]
                          : value.filter((name) => name !== tag.name)
                      )
                    }
                  />
                  <span className="truncate">{tag.name}</span>
                  <span className="text-muted-foreground ml-auto text-xs">{tag.contact_count}</span>
                </label>
              ))
            ) : (
              <p className="text-muted-foreground p-2 text-sm">{t("noTagMatch")}</p>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

const sizeLabel = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** 只列启用资产；已选但已停用 / 不存在的资产保留显示并标红，便于移除。 */
function AttachmentPicker({ value, onChange }: { value: string[]; onChange: (value: string[]) => void }) {
  const t = useTranslations("ContentRules");
  const { data: assets = [] } = useAssets();
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const enabled = assets.filter((asset) => asset.enabled);
  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ol className="space-y-1">
          {value.map((id, position) => {
            const asset = byId.get(id);
            const usable = asset?.enabled ?? false;
            return (
              <li key={id} className="flex items-center gap-2 text-sm">
                <Paperclip className="size-3.5 shrink-0" />
                <span className={usable ? "truncate" : "text-destructive truncate"}>
                  {asset?.filename ?? id}
                  {!asset ? t("missing") : !asset.enabled ? t("disabled") : ""}
                </span>
                {asset && (
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {sizeLabel(asset.size_bytes)}
                  </span>
                )}
                <span className="ml-auto flex shrink-0">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    aria-label={t("moveAttachmentUp")}
                    disabled={position === 0}
                    onClick={() => {
                      const next = [...value];
                      [next[position - 1], next[position]] = [next[position]!, next[position - 1]!];
                      onChange(next);
                    }}
                  >
                    <ArrowUp className="size-3" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    aria-label={t("removeAttachment")}
                    onClick={() => onChange(value.filter((item) => item !== id))}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full justify-between"
            disabled={value.length >= CONTENT_RULE_LIMITS.attachments}
          >
            {t("addAttachment")}
            <ChevronsUpDown className="opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-2" align="start">
          <div className="max-h-56 space-y-1 overflow-y-auto">
            {enabled.length ? (
              enabled.map((asset) => (
                <label
                  key={asset.id}
                  className="hover:bg-muted flex items-center gap-2 rounded px-1 py-1 text-sm"
                >
                  <Checkbox
                    checked={value.includes(asset.id)}
                    disabled={
                      !value.includes(asset.id) && value.length >= CONTENT_RULE_LIMITS.attachments
                    }
                    onCheckedChange={(checked) =>
                      onChange(
                        checked
                          ? [...value, asset.id]
                          : value.filter((item) => item !== asset.id)
                      )
                    }
                  />
                  <span className="truncate">{asset.filename}</span>
                  <span className="text-muted-foreground ml-auto shrink-0 text-xs">
                    {sizeLabel(asset.size_bytes)}
                  </span>
                </label>
              ))
            ) : (
              <p className="text-muted-foreground p-2 text-sm">{t("noAssets")}</p>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
