"use client";

import * as React from "react";
import { useFieldArray, useWatch, type UseFormReturn } from "react-hook-form";
import type { z } from "zod";
import { FileText, Plus, Sparkles, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { canonicalIndustry, CONTENT_RULE_LIMITS, type CampaignBody, type CampaignDto } from "@mailqivo/shared";
import { templateApi } from "@/lib/api/content";
import { industryOptions } from "@/lib/gics";
import { useAssets } from "@/lib/api/assets";
import { useImproveDraft } from "@/lib/api/campaigns";
import { useTags } from "@/lib/api/tags";
import { ApiError } from "@/lib/api/client";
import { toggleRuleSelection } from "@/lib/rule-selection";
import { AiSidebar } from "./ai-sidebar";
import { EmailEditor } from "@/components/edm/email-editor";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type FormValues = z.input<typeof CampaignBody>;
type Form = UseFormReturn<FormValues>;

const ANY = "all";

export function ComposePanel({
  form,
  campaign,
  campaignId,
  onAutosave
}: {
  form: Form;
  campaign?: CampaignDto;
  campaignId?: string;
  onAutosave: (silent?: boolean) => Promise<string | null>;
}) {
  const t = useTranslations("CampaignEditor");
  const tIndustry = useTranslations("Industry");
  const [improveOpen, setImproveOpen] = React.useState(false);
  const industries = industryOptions(tIndustry);
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Label htmlFor="campaign-subject" className="shrink-0">
            {t("letterSubject")}
          </Label>
          <FormField
            control={form.control}
            name="subject"
            render={({ field }) => (
              <FormItem className="min-w-48 flex-1">
                <FormControl>
                  <Input id="campaign-subject" {...field} placeholder={t("subjectPh")} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <TemplateSelect form={form} />
        </div>
        <p className="text-sm">
          <span className="text-muted-foreground mr-3">{t("recipients")}</span>
          {t("recipientsHint")}
        </p>
        <div className="relative">
          <FormField
            control={form.control}
            name="html"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <EmailEditor
                    value={field.value}
                    onChange={field.onChange}
                    mode={form.watch("editor_mode") ?? "rich"}
                    onModeChange={(mode) => form.setValue("editor_mode", mode, { shouldDirty: true })}
                    autosaveKey={campaignId ?? "campaign:new"}
                    serverUpdatedAt={campaign?.updated_at}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="absolute right-3 bottom-3 z-10 bg-background"
            onClick={() => setImproveOpen(true)}
          >
            <Sparkles />
            {t("aiImprove")}
          </Button>
        </div>
        <AttachmentBar form={form} industries={industries} />
        <AiSidebar form={form} onSave={onAutosave} />
      </CardContent>
      <ImproveDialog
        open={improveOpen}
        html={form.getValues("html")}
        onClose={() => setImproveOpen(false)}
        onApply={(html) => {
          form.setValue("html", html, { shouldDirty: true });
          setImproveOpen(false);
        }}
      />
    </Card>
  );
}

function TemplateSelect({ form }: { form: Form }) {
  const t = useTranslations("CampaignEditor");
  const { data: templates = [] } = templateApi.useList();
  const selected = form.watch("template_id") ?? "none";
  function applyTemplate(templateId: string) {
    if (templateId === "none") {
      form.setValue("template_id", null, { shouldDirty: true });
      return;
    }
    const template = templates.find((item) => item.id === templateId);
    if (!template) return;
    form.setValue("template_id", template.id, { shouldDirty: true });
    form.setValue("html", template.html, { shouldDirty: true });
    form.setValue("editor_mode", template.editor_mode, { shouldDirty: true });
    toast.success(t("templateCopied"));
  }
  return (
    <Select value={selected} onValueChange={applyTemplate}>
      <SelectTrigger className="w-44" aria-label={t("importTemplate")}>
        <SelectValue placeholder={t("importTemplate")} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">{t("noTemplate")}</SelectItem>
        {templates.map((template) => (
          <SelectItem key={template.id} value={template.id}>
            {template.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ImproveDialog({
  open,
  html,
  onClose,
  onApply
}: {
  open: boolean;
  html: string;
  onClose: () => void;
  onApply: (html: string) => void;
}) {
  const t = useTranslations("CampaignEditor");
  const improve = useImproveDraft();
  const [instruction, setInstruction] = React.useState("");
  async function run() {
    const text = instruction.trim();
    if (!text) return;
    try {
      const result = await improve.mutateAsync({ html, instruction: text });
      onApply(result.html);
      setInstruction("");
      toast.success(t("aiImproveDone"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("aiImproveFail"));
    }
  }
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("aiImproveTitle")}</DialogTitle>
          <DialogDescription>{t("aiImproveDesc")}</DialogDescription>
        </DialogHeader>
        <Textarea
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          placeholder={t("aiImprovePh")}
          rows={4}
          maxLength={2000}
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("close")}
          </Button>
          <Button type="button" disabled={improve.isPending || instruction.trim() === ""} onClick={run}>
            <Sparkles />
            {improve.isPending ? t("aiImproving") : t("aiImproveAction")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AttachmentBar({ form, industries }: { form: Form; industries: ReturnType<typeof industryOptions> }) {
  const t = useTranslations("CampaignEditor");
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "content_rules", keyName: "_key" });
  const rules = useWatch({ control: form.control, name: "content_rules" }) ?? [];
  const nextPriority = () => (rules.length ? Math.max(...rules.map((rule) => Number(rule?.priority ?? 0))) + 10 : 10);
  function add() {
    append({
      name: t("attachAnyIndustry"),
      tags_all: [],
      industry: "",
      instruction: "",
      attachment_ids: [],
      priority: nextPriority(),
      enabled: true
    });
  }
  return (
    <div className="space-y-2 border-t pt-3">
      {fields.length === 0 && (
        <div className="flex items-center gap-2">
          <span className="text-sm">{t("attachments")}</span>
          <Button type="button" size="icon" variant="outline" aria-label={t("addAttachmentRow")} onClick={add}>
            <Plus />
          </Button>
        </div>
      )}
      {fields.map((field, index) => (
        <div key={field._key} className="flex flex-wrap items-center gap-2">
          <span className="text-sm">{t("attachments")}</span>
          <IndustryChip form={form} index={index} industries={industries} />
          <TagChip form={form} index={index} />
          <FileChip form={form} index={index} />
          <Button type="button" size="icon" variant="ghost" aria-label={t("removeAttachmentRow")} onClick={() => remove(index)}>
            <Trash2 />
          </Button>
          {index === fields.length - 1 && (
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-label={t("addAttachmentRow")}
              disabled={fields.length >= CONTENT_RULE_LIMITS.rules}
              onClick={add}
            >
              <Plus />
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

function IndustryChip({ form, index, industries }: { form: Form; index: number; industries: ReturnType<typeof industryOptions> }) {
  const t = useTranslations("CampaignEditor");
  return (
    <FormField
      control={form.control}
      name={`content_rules.${index}.industry`}
      render={({ field }) => (
        <Select value={canonicalIndustry(field.value ?? "") || ANY} onValueChange={(value) => field.onChange(value === ANY ? "" : value)}>
          <SelectTrigger className="w-44" aria-label={t("attachIndustry")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>{t("attachAnyIndustry")}</SelectItem>
            {industries.map(({ value, label }) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
            {field.value && !industries.some((option) => option.value === canonicalIndustry(field.value ?? "")) && <SelectItem value={field.value}>{field.value}</SelectItem>}
          </SelectContent>
        </Select>
      )}
    />
  );
}

function TagChip({ form, index }: { form: Form; index: number }) {
  const t = useTranslations("CampaignEditor");
  const { data: tags = [] } = useTags();
  return (
    <FormField
      control={form.control}
      name={`content_rules.${index}.tags_all`}
      render={({ field }) => {
        const selected = field.value ?? [];
        const known = new Set(tags.map((tag) => tag.name));
        const options = [
          ...tags.map((tag) => ({ id: tag.id, name: tag.name, available: true })),
          ...selected.filter((name) => !known.has(name)).map((name) => ({ id: name, name, available: false }))
        ];
        return (
          <Popover>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" size="sm" className="max-w-56" aria-label={t("attachTag")}>
                <span className="truncate">{selected.length ? selected.join(", ") : t("attachAnyTag")}</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-2" align="start">
              {options.length === 0 ? (
                <p className="text-muted-foreground p-2 text-sm">{t("attachAnyTag")}</p>
              ) : (
                <ul className="max-h-56 space-y-1 overflow-y-auto">
                  {options.map((option) => {
                    const checked = selected.includes(option.name);
                    return (
                      <li key={option.id}>
                        <label className="hover:bg-muted flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm">
                          <Checkbox
                            checked={checked}
                            disabled={!checked && selected.length >= CONTENT_RULE_LIMITS.tags_all}
                            onCheckedChange={(next) =>
                              field.onChange(toggleRuleSelection(selected, option.name, next === true, CONTENT_RULE_LIMITS.tags_all))
                            }
                          />
                          <span className={option.available ? "truncate" : "text-destructive truncate"}>{option.name}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </PopoverContent>
          </Popover>
        );
      }}
    />
  );
}

function FileChip({ form, index }: { form: Form; index: number }) {
  const t = useTranslations("CampaignEditor");
  const { data: assets = [] } = useAssets();
  return (
    <FormField
      control={form.control}
      name={`content_rules.${index}.attachment_ids`}
      render={({ field }) => {
        const selected = field.value ?? [];
        const byId = new Map(assets.map((asset) => [asset.id, asset]));
        const options = [
          ...assets.filter((asset) => asset.enabled),
          ...selected.filter((id) => !byId.get(id)?.enabled).map((id) => byId.get(id) ?? {
            id,
            filename: id,
            enabled: false
          })
        ];
        const label = selected.map((id) => byId.get(id)?.filename ?? id).join(", ");
        return (
          <Popover>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" size="sm" className="max-w-64">
                <FileText />
                <span className="truncate">{label || t("pickAttachment")}</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-2" align="start">
              {options.length === 0 ? (
                <p className="text-muted-foreground p-2 text-sm">{t("noAssets")}</p>
              ) : (
                <ul className="max-h-56 space-y-1 overflow-y-auto">
                  {options.map((item) => {
                    const checked = selected.includes(item.id);
                    return (
                      <li key={item.id}>
                        <label className="hover:bg-muted flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm">
                          <Checkbox
                            checked={checked}
                            disabled={!checked && selected.length >= CONTENT_RULE_LIMITS.attachments}
                            onCheckedChange={(next) =>
                              field.onChange(toggleRuleSelection(selected, item.id, next === true, CONTENT_RULE_LIMITS.attachments))
                            }
                          />
                          <span className={item.enabled ? "truncate" : "text-destructive truncate"}>{item.filename}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </PopoverContent>
          </Popover>
        );
      }}
    />
  );
}
