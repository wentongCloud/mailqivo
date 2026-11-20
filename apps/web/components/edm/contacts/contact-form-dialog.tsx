"use client";

import * as React from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { z } from "zod";
import { Star } from "lucide-react";
import { CITY_KEYS, COUNTRY_KEYS, LANGUAGE_KEYS, MANUAL_CONSENT_SOURCE_VALUES, readProfileField, type ContactDto } from "@mailqivo/shared";
import { useLocalizedLabels } from "@/hooks/use-app-locale";

import { ApiError } from "@/lib/api/client";
import { useCreateContact, useUpdateContact } from "@/lib/api/contacts";
import { useTags } from "@/lib/api/tags";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CountrySelect } from "./country-combobox";
import { IndustrySelect } from "./industry-combobox";
import { TitleSelect } from "./title-select";

function buildFormSchema(t: ReturnType<typeof useTranslations<"Contacts">>) {
  return z.object({
    email: z.string().trim().min(1, t("emailRequired")).pipe(z.email(t("emailInvalid"))),
    name: z.string().trim().max(200),
    company: z.string().trim().max(200),
    title: z.string().trim().max(200),
    industry: z.string().trim().max(100),
    country: z.string().trim().max(100),
    city: z.string().trim().max(100),
    language: z.string().trim().max(50),
    level: z.enum(["1", "2", "3", "4", "5"]),
    tags: z.string(),
    /** 仅新建时提交；建行后只读（§10.1） */
    consent_source: z.enum(MANUAL_CONSENT_SOURCE_VALUES)
  });
}
type FormValues = z.infer<ReturnType<typeof buildFormSchema>>;

const splitTags = (text: string) =>
  [...new Set(text.split(/[,，、\n]/).map((s) => s.trim()).filter(Boolean))];

/** 资料字段的 key 与读取规则在 @mailqivo/shared，服务端生成 {{称呼}} 时用同一份。 */
export { CITY_KEYS, COUNTRY_KEYS, LANGUAGE_KEYS, readProfileField };
export const LANGUAGE_OPTIONS = ["中文", "English"] as const;

function writeProfileField(fields: Record<string, string>, keys: readonly string[], value: string) {
  for (const key of keys) delete fields[key];
  const trimmed = value.trim();
  if (trimmed) fields[keys[0]!] = trimmed;
}

function defaults(contact?: ContactDto): FormValues {
  return {
    email: contact?.email ?? "",
    name: contact?.name ?? "",
    company: contact?.company ?? "",
    title: contact?.title ?? "",
    industry: contact?.custom_fields.industry ?? "",
    country: readProfileField(contact?.custom_fields, COUNTRY_KEYS),
    city: readProfileField(contact?.custom_fields, CITY_KEYS),
    language: readProfileField(contact?.custom_fields, LANGUAGE_KEYS),
    level: (["1", "2", "3", "4", "5"].includes(contact?.custom_fields.level ?? "") ? contact?.custom_fields.level : "2") as FormValues["level"],
    tags: contact?.tags.join("，") ?? "",
    consent_source: "manual"
  };
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 传入则为编辑，否则为新建 */
  contact?: ContactDto;
};

export function ContactFormDialog({ open, onOpenChange, contact }: Props) {
  // key 保证每次打开都用最新的联系人数据重置表单
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        {open && <ContactForm key={contact?.id ?? "new"} contact={contact} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function ContactForm({ contact, onDone }: { contact?: ContactDto; onDone: () => void }) {
  const t = useTranslations("Contacts");
  const tc = useTranslations("Common");
  const labels = useLocalizedLabels();
  const isEdit = Boolean(contact);
  const create = useCreateContact();
  const update = useUpdateContact();
  const { data: allTags = [] } = useTags();
  const schema = React.useMemo(() => buildFormSchema(t), [t]);
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: defaults(contact) });
  const pending = create.isPending || update.isPending;
  const currentTags = splitTags(useWatch({ control: form.control, name: "tags" }));
  const tagJoin = labels.locale === "zh-CN" ? "，" : ", ";

  const toggleTag = (name: string) => {
    const next = currentTags.includes(name) ? currentTags.filter((item) => item !== name) : [...currentTags, name];
    form.setValue("tags", next.join(tagJoin), { shouldDirty: true });
  };

  async function onSubmit(values: FormValues) {
    const customFields = { ...contact?.custom_fields };
    if (values.industry) customFields.industry = values.industry;
    else delete customFields.industry;
    writeProfileField(customFields, COUNTRY_KEYS, values.country);
    writeProfileField(customFields, CITY_KEYS, values.city);
    writeProfileField(customFields, LANGUAGE_KEYS, values.language);
    if (values.level) customFields.level = values.level;
    else delete customFields.level;
    const body = {
      email: values.email,
      name: values.name || null,
      company: values.company || null,
      title: values.title || null,
      custom_fields: customFields,
      tags: splitTags(values.tags)
    };
    try {
      if (contact) await update.mutateAsync({ id: contact.id, body });
      else await create.mutateAsync({ ...body, consent_source: values.consent_source });
      toast.success(isEdit ? t("updated") : t("created"));
      onDone();
    } catch (err) {
      if (err instanceof ApiError) {
        const details = err.body.details as { path?: string; message: string }[] | undefined;
        const emailIssue = details?.find((d) => d.path === "email");
        if (emailIssue) {
          form.setError("email", { message: emailIssue.message });
          return;
        }
        toast.error(err.message);
      } else {
        toast.error(t("saveFailed"));
      }
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <DialogHeader>
          <DialogTitle>{isEdit ? t("edit") : t("new")}</DialogTitle>
          <DialogDescription>{isEdit ? t("editDesc") : t("createDescManual")}</DialogDescription>
        </DialogHeader>

        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("email")}</FormLabel>
              <FormControl>
                <Input type="email" placeholder="name@example.com" autoComplete="off" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid gap-4 sm:grid-cols-2">
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
            name="title"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("titleField")}</FormLabel>
                <TitleSelect value={field.value} onChange={field.onChange} />
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="company"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("company")}</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="country"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("country")}</FormLabel>
                <CountrySelect value={field.value} onChange={field.onChange} />
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="city"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("city")}</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="language"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("language")}</FormLabel>
              <Select value={field.value || "unset"} onValueChange={(value) => field.onChange(value === "unset" ? "" : value)}>
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="unset">{t("languageUnset")}</SelectItem>
                  {LANGUAGE_OPTIONS.map((language) => (
                    <SelectItem key={language} value={language}>
                      {language}
                    </SelectItem>
                  ))}
                  {field.value && !LANGUAGE_OPTIONS.includes(field.value as (typeof LANGUAGE_OPTIONS)[number]) && (
                    <SelectItem value={field.value}>{field.value}</SelectItem>
                  )}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="industry"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("industry")}</FormLabel>
                <IndustrySelect value={field.value} onChange={field.onChange} />
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="level"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("level")}</FormLabel>
                <FormControl>
                  <RadioGroup
                    value={field.value}
                    onValueChange={field.onChange}
                    className="flex min-h-8 items-center gap-1"
                    aria-label={t("levelAria")}
                  >
                    {["1", "2", "3", "4", "5"].map((level) => (
                      <span key={level} className="relative flex">
                        <RadioGroupItem
                          id={`contact-level-${level}`}
                          value={level}
                          className="peer sr-only"
                          aria-label={t("starAria", { n: level })}
                        />
                        <label
                          htmlFor={`contact-level-${level}`}
                          className="cursor-pointer rounded-sm text-muted-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring"
                          aria-hidden="true"
                        >
                          <Star
                            className={`size-6 ${Number(level) <= Number(field.value) ? "fill-current text-foreground" : ""}`}
                          />
                        </label>
                      </span>
                    ))}
                  </RadioGroup>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="tags"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("tags")}</FormLabel>
              <FormControl>
                <Input placeholder={t("tagsPh")} {...field} />
              </FormControl>
              {allTags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {allTags.map((tag) => (
                    <button type="button" key={tag.id} onClick={() => toggleTag(tag.name)}>
                      <Badge variant={currentTags.includes(tag.name) ? "default" : "outline"}>{tag.name}</Badge>
                    </button>
                  ))}
                </div>
              )}
              <FormDescription>{t("tagsHint")}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {!isEdit && (
          <FormField
            control={form.control}
            name="consent_source"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{labels.common("consentSourceColumn")}</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {MANUAL_CONSENT_SOURCE_VALUES.map((v) => (
                      <SelectItem key={v} value={v}>
                        {labels.consentSource[v]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormDescription>{t("consentHint")}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDone}>
            {tc("cancel")}
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? tc("saving") : tc("save")}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}
