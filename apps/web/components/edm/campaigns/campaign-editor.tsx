"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm, useWatch, type UseFormReturn } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, Info, Plus, Save, Search, Send, TestTube2, Trash2, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { canonicalIndustry, CampaignBody, type CampaignDto, type ContactDto, type ContactFilterInput } from "@mailqivo/shared";
import { createDraftSaver } from "@/lib/campaign-draft-save";
import { industryOptions } from "@/lib/gics";
import { useLocalizedLabels } from "@/hooks/use-app-locale";
import { useCampaign, useCreateCampaign, useUpdateCampaign } from "@/lib/api/campaigns";
import { useChannels } from "@/lib/api/channels";
import { countActiveContacts, useContacts } from "@/lib/api/contacts";
import { signatureApi } from "@/lib/api/content";
import { useTags } from "@/lib/api/tags";
import { ApiError } from "@/lib/api/client";
import { clearEditorDraft } from "@/components/edm/email-editor";
import { DateTimePicker } from "@/components/date-time-picker";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger
} from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Stepper,
  StepperContent,
  StepperDescription,
  StepperIndicator,
  StepperItem,
  StepperList,
  StepperSeparator,
  StepperTitle,
  StepperTrigger
} from "@/components/ui/stepper";
import { Switch } from "@/components/ui/switch";
import { ComposePanel } from "./compose-panel";
import { RuleProblems, ruleProblemsOf } from "./rule-problems";
import { SendCampaignDialog } from "./send-campaign-dialog";
import { TestSendDialog } from "./test-send-dialog";

type FormValues = z.input<ReturnType<typeof buildCampaignFormSchema>>;
type Form = UseFormReturn<FormValues>;
type Step = 1 | 2 | 3;

/** 定时时间已到或已过。 */
function isPast(value: string | null | undefined): boolean {
  return !!value && new Date(value).getTime() <= Date.now();
}

function buildCampaignFormSchema(t: ReturnType<typeof useTranslations<"CampaignEditor">>) {
  return CampaignBody.extend({
    name: z.string().trim().min(1, t("nameRequired")).max(100, t("nameMax")),
    subject: z.string().trim().min(1, t("subjectRequired")).max(100, t("subjectMax"))
  });
}

function useInitialValues(t: ReturnType<typeof useTranslations<"CampaignEditor">>): FormValues {
  return React.useMemo(
    () => ({
      name: "",
      subject: "",
      html: t.raw("defaultBody") as string,
      editor_mode: "rich",
      template_id: null,
      signature_id: null,
      channel_id: null,
      contact_filter: { statuses: ["active"], exclude_domain_suspect: false },
      ai_goal: null,
      ai_fields: [],
      ai_blocks: [],
      track_opens: true,
      track_clicks: false,
      content_rules: [],
      send_at: null
    }),
    [t]
  );
}

export function CampaignEditor({ id }: { id?: string }) {
  const t = useTranslations("CampaignEditor");
  const labels = useLocalizedLabels();
  const router = useRouter();
  const { data: campaign, isLoading } = useCampaign(id);
  const [campaignId, setCampaignId] = React.useState(id);
  const savedId = React.useRef(id);
  const hydratedId = React.useRef<string | undefined>(undefined);
  const [saveLatest] = React.useState(createDraftSaver);
  const [step, setStep] = React.useState<Step>(1);
  const [highestStep, setHighestStep] = React.useState<Step>(1);
  const [sendOpen, setSendOpen] = React.useState(false);
  // 设计 §1 第 3 步：过期定时可能被自动保存静默清为立即发送，记录下来，在打开试发或发送对话框时提示。
  const scheduleCleared = React.useRef(false);
  const [scheduleChanged, setScheduleChanged] = React.useState(false);
  const lastSaveError = React.useRef<unknown>(null);
  const [audienceTotal, setAudienceTotal] = React.useState<number | null>(null);
  const [testOpen, setTestOpen] = React.useState(false);
  const schema = React.useMemo(() => buildCampaignFormSchema(t), [t]);
  const initialValues = useInitialValues(t);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: initialValues,
    mode: "onSubmit",
    reValidateMode: "onChange"
  });
  const create = useCreateCampaign();
  const update = useUpdateCampaign();
  const saving = create.isPending || update.isPending;
  const sendAt = useWatch({ control: form.control, name: "send_at" });
  // 必须在 render 中订阅，否则 RHF Proxy 不会触发重渲染，离开守卫 / 自动保存会失效。
  const isDirty = form.formState.isDirty;

  const steps = React.useMemo(
    () => [
      { id: 1 as const, title: t("stepBasic"), description: t("stepBasicDesc") },
      { id: 2 as const, title: t("stepAudience"), description: t("stepAudienceDesc") },
      { id: 3 as const, title: t("stepContent"), description: t("stepContentDesc") }
    ],
    [t]
  );

  React.useEffect(() => {
    if (!campaign || hydratedId.current === campaign.id) return;
    hydratedId.current = campaign.id;
    savedId.current = campaign.id;
    setCampaignId(campaign.id);
    const html = campaign.html === "CampaignEditor.defaultBody" ? (t.raw("defaultBody") as string) : campaign.html;
    form.reset({ ...campaign, html });
  }, [campaign, form, t]);
  React.useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (isDirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [isDirty]);

  const saveDraft = React.useCallback(
    (silent = false): Promise<string | null> => saveLatest(() => form.getValues(), async (values) => {
      const parsed = schema.safeParse(values);
      if (!parsed.success) {
        await form.trigger();
        const firstPath = parsed.error.issues[0]?.path.join(".") ?? "";
        const errorStep: Step =
          firstPath === "name" || firstPath === "subject" || firstPath === "send_at"
            ? 1
            : firstPath.startsWith("contact_filter")
              ? 2
              : 3;
        setStep(errorStep);
        setHighestStep((current) => Math.max(current, errorStep) as Step);
        if (!silent) toast.error(t("formInvalid"));
        return null;
      }
      lastSaveError.current = null;
      try {
        const body = parsed.data;
        const currentId = savedId.current;
        const saved = currentId
          ? await update.mutateAsync({ id: currentId, body })
          : await create.mutateAsync(body);
        savedId.current = saved.id;
        if (body.send_at && !saved.send_at) scheduleCleared.current = true;
        return {
          id: saved.id,
          apply() {
            clearEditorDraft(id ?? "campaign:new");
            clearEditorDraft(saved.id);
            setCampaignId(saved.id);
            form.reset(saved);
            if (!id) router.replace(`/campaigns/${saved.id}/edit`);
            if (!silent) toast.success(t("draftSaved"));
          }
        };
      } catch (err) {
        lastSaveError.current = err;
        if (!silent) toast.error(err instanceof ApiError ? err.message : t("saveFail"));
        return null;
      }
    }),
    [saveLatest, id, create, form, router, schema, t, update]
  );

  React.useEffect(() => {
    const timer = window.setInterval(() => {
      if (isDirty && campaign?.status !== "failed") void saveDraft(true);
    }, 10000);
    return () => window.clearInterval(timer);
  }, [campaign?.status, isDirty, saveDraft]);

  async function goNext() {
    if (step === 1) {
      if (!(await form.trigger(["name", "subject", "send_at"]))) return;
      const planned = form.getValues("send_at");
      if (isPast(planned)) {
        toast.error(t("schedulePast"));
        return;
      }
    } else if (step === 2) {
      if (!(await form.trigger("contact_filter"))) return;
    }

    for (;;) {
      const checked = step === 2 ? await audienceReady() : undefined;
      if (checked === null) return;
      if (checked !== undefined && checked !== audienceKey()) continue;
      if (!(await saveDraft())) return;
      if (checked === undefined || checked === audienceKey()) break;
    }
    const next = (step + 1) as Step;
    setStep(next);
    setHighestStep((current) => Math.max(current, next) as Step);
  }

  function audienceKey() {
    return JSON.stringify(form.getValues("contact_filter") ?? {});
  }

  /**
   * 设计 §1 第 2 步：目标客群没有有效联系人时不能进入第三步。「下一步」与顶部步骤共用此检查。
   * 计数请求失败时保留当前步骤，并提示原因与重试。
   * 计数期间客群条件被修改时，旧计数作废，按最新条件重新计数，避免放行零人草稿。
   */
  async function audienceReady(): Promise<string | null> {
    for (;;) {
      const filter = form.getValues("contact_filter") ?? {};
      const checked = JSON.stringify(filter);
      let count: number;
      try {
        count = await countActiveContacts(filter);
      } catch (err) {
        if (checked !== audienceKey()) continue;
        toast.error(t("audienceCountFail"), { description: err instanceof ApiError ? err.message : undefined });
        return null;
      }
      if (checked !== audienceKey()) continue;
      if (count > 0) return checked;
      toast.error(t("audienceZero"));
      return null;
    }
  }

  async function goToStep(target: Step) {
    if (target === 3 && step !== 3) {
      const checked = await audienceReady();
      if (checked === null || checked !== audienceKey()) return;
    }
    setStep(target);
  }

  async function openAction(action: "send" | "test") {
    const planned = form.getValues("send_at");
    if (isPast(planned)) {
      form.setValue("send_at", null, { shouldDirty: true });
      scheduleCleared.current = true;
    }
    const savedId = await saveDraft(true);
    if (!savedId) {
      const error = lastSaveError.current;
      const problems = ruleProblemsOf(error);
      toast.error(error instanceof ApiError ? error.message : t("saveDraftFirst"), {
        description: problems.length ? <RuleProblems problems={problems} /> : undefined
      });
      return;
    }
    const changed = scheduleCleared.current;
    scheduleCleared.current = false;
    if (changed) toast.warning(t("scheduleExpired"));
    setScheduleChanged(changed);
    if (action === "send") setSendOpen(true);
    else setTestOpen(true);
  }

  function leaveGuard(event: React.MouseEvent<HTMLAnchorElement>) {
    if (isDirty && !window.confirm(t("leaveConfirm"))) event.preventDefault();
  }

  if (id && isLoading) return <Skeleton className="h-[70vh]" />;
  if (campaign && campaign.status !== "draft") {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" aria-label={t("backToList")} asChild>
            <Link href="/campaigns">
              <ArrowLeft />
            </Link>
          </Button>
          <div>
            <h1 className="text-xl font-semibold">{t("cannotEdit")}</h1>
            <p className="text-muted-foreground text-sm">
              {t("cannotEditDesc", { status: labels.campaignStatus[campaign.status] })}
            </p>
          </div>
        </div>
        <Alert>
          <Info />
          <AlertTitle>{t("lockedTitle")}</AlertTitle>
          <AlertDescription>
            {t.rich("lockedDesc", {
              link: (chunks) => (
                <Link className="underline" href={`/campaigns/${campaign.id}`}>
                  {chunks}
                </Link>
              )
            })}
          </AlertDescription>
        </Alert>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" aria-label={t("backToList")} asChild>
          <Link href="/campaigns" onClick={leaveGuard}>
            <ArrowLeft />
          </Link>
        </Button>
        <div>
          <h1 className="text-xl font-semibold">{id ? t("editTitle") : t("createTitle")}</h1>
          <p className="text-muted-foreground text-sm">{t("headerDesc")}</p>
        </div>
      </div>

      <Stepper aria-label={t("stepsAria")} className="px-0 pb-5">
        <StepperList>
          {steps.map((item) => {
            const completed = highestStep > item.id;
            const active = step === item.id;
            return (
              <React.Fragment key={item.id}>
                <StepperItem>
                  <StepperTrigger
                    disabled={item.id > highestStep}
                    onClick={() => void goToStep(item.id)}
                    aria-current={active ? "step" : undefined}
                  >
                    <StepperIndicator active={active} completed={completed}>
                      {item.id}
                    </StepperIndicator>
                    <StepperContent>
                      <StepperTitle>{item.title}</StepperTitle>
                      <StepperDescription>{item.description}</StepperDescription>
                    </StepperContent>
                  </StepperTrigger>
                </StepperItem>
                {item.id < steps.length && <StepperSeparator />}
              </React.Fragment>
            );
          })}
        </StepperList>
      </Stepper>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(() => saveDraft())}>
          {step === 1 && <BasicInfoStep form={form} />}
          {step === 2 && <AudienceStep form={form} onTotalChange={setAudienceTotal} />}
          {step === 3 && (
            <ContentStep form={form} campaign={campaign} campaignId={campaignId} onAutosave={saveDraft} />
          )}

          <div className="bg-background sticky bottom-0 z-10 mt-4 flex flex-wrap items-center justify-between gap-2 py-3">
            <div>
              {step > 1 && (
                <Button type="button" variant="ghost" onClick={() => setStep((step - 1) as Step)}>
                  <ArrowLeft />
                  {t("prev")}
                </Button>
              )}
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {step < 3 ? (
                <Button type="button" variant="outline" disabled={saving} onClick={() => saveDraft()}>
                  <Save />
                  {t("saveDraft")}
                </Button>
              ) : (
                <>
                  <Button type="submit" variant="outline" disabled={saving}>
                    <Save />
                    {t("saveDraft")}
                  </Button>
                  <Button type="button" variant="outline" disabled={saving} onClick={() => openAction("test")}>
                    <TestTube2 />
                    {t("testSend")}
                  </Button>
                </>
              )}
              {step === 2 && audienceTotal === 0 && (
                <p className="text-destructive self-center text-sm">{t("audienceZero")}</p>
              )}
              {step < 3 ? (
                <Button type="button" disabled={saving || (step === 2 && audienceTotal === 0)} onClick={goNext}>
                  {t("next")}
                  <ArrowRight />
                </Button>
              ) : (
                <Button type="button" disabled={saving} onClick={() => openAction("send")}>
                  <Send />
                  {t("send")}
                </Button>
              )}
            </div>
          </div>
        </form>
      </Form>
      {campaignId && (
        <>
          <SendCampaignDialog
            campaignId={campaignId}
            open={sendOpen}
            onClose={() => setSendOpen(false)}
            schedule={typeof sendAt === "string" ? sendAt : undefined}
            scheduleChanged={scheduleChanged}
          />
          <TestSendDialog campaignId={campaignId} open={testOpen} onClose={() => setTestOpen(false)} />
        </>
      )}
    </div>
  );
}

function BasicInfoStep({ form }: { form: Form }) {
  const t = useTranslations("CampaignEditor");
  const { data: channels = [] } = useChannels();
  const { data: signatures = [] } = signatureApi.useList();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const sendAt = useWatch({ control: form.control, name: "send_at" });
  const scheduleMode = sendAt ? "scheduled" : "now";
  const scheduleDate = sendAt ? new Date(sendAt) : undefined;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("stepBasic")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-8">
        <div className="grid gap-4 md:grid-cols-2">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {t("name")}{" "}
                  <span className="text-destructive" aria-label={t("required")}>
                    *
                  </span>
                </FormLabel>
                <FormControl>
                  <Input {...field} maxLength={100} placeholder={t("namePh")} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="subject"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {t("subject")}{" "}
                  <span className="text-destructive" aria-label={t("required")}>
                    *
                  </span>
                </FormLabel>
                <InputGroup>
                  <FormControl>
                    <InputGroupInput {...field} maxLength={100} placeholder={t("subjectPh")} />
                  </FormControl>
                  <InputGroupAddon align="inline-end">
                    <Popover>
                      <PopoverTrigger asChild>
                        <InputGroupButton size="icon-xs" aria-label={t("varsHintAria")}>
                          <Info />
                        </InputGroupButton>
                      </PopoverTrigger>
                      <PopoverContent align="end" className="w-80">
                        <PopoverHeader>
                          <PopoverTitle>{t("varsTitle")}</PopoverTitle>
                          <PopoverDescription>{t("varsDesc")}</PopoverDescription>
                        </PopoverHeader>
                        <div className="space-y-1 text-sm">
                          <p>
                            <code>{"{{姓名}}"}</code>：{t("varName")}
                          </p>
                          <p>
                            <code>{"{{公司}}"}</code>：{t("varCompany")}
                          </p>
                          <p>
                            <code>{"{{职位}}"}</code>：{t("varTitle")}
                          </p>
                          <p className="text-muted-foreground">{t("varFallbackHint")}</p>
                        </div>
                      </PopoverContent>
                    </Popover>
                  </InputGroupAddon>
                </InputGroup>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="channel_id"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("channel")}</FormLabel>
                <Select
                  value={field.value ?? "default"}
                  onValueChange={(value) => field.onChange(value === "default" ? null : value)}
                >
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t("defaultChannel")} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="default">{t("defaultChannel")}</SelectItem>
                    {channels.map((channel) => (
                      <SelectItem key={channel.id} value={channel.id}>
                        {channel.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="signature_id"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("signature")}</FormLabel>
                <Select
                  value={field.value ?? "default"}
                  onValueChange={(value) => field.onChange(value === "default" ? null : value)}
                >
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t("defaultSignature")} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="default">{t("defaultSignature")}</SelectItem>
                    {signatures.map((signature) => (
                      <SelectItem key={signature.id} value={signature.id}>
                        {signature.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <div className="grid gap-6 border-y py-5 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="track_opens"
            render={({ field }) => (
              <FormItem className="flex items-center justify-between gap-4">
                <div>
                  <FormLabel>{t("trackOpens")}</FormLabel>
                  <p className="text-muted-foreground text-xs">{t("trackOpensHint")}</p>
                </div>
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="track_clicks"
            render={({ field }) => (
              <FormItem className="flex items-center justify-between gap-4">
                <div>
                  <FormLabel>{t("trackClicks")}</FormLabel>
                  <p className="text-muted-foreground text-xs">{t("trackClicksHint")}</p>
                </div>
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="send_at"
          render={({ field }) => (
            <FormItem className="space-y-3">
              <FormLabel>{t("schedule")}</FormLabel>
              <RadioGroup
                value={scheduleMode}
                onValueChange={(value) => {
                  if (value === "now") field.onChange(null);
                  else field.onChange(new Date(Date.now() + 3600_000).toISOString());
                }}
                className="flex flex-col gap-1"
              >
                <Label className="flex min-h-11 w-fit cursor-pointer items-center gap-2">
                  <RadioGroupItem value="now" />
                  {t("sendNow")}
                </Label>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Label className="flex min-h-11 shrink-0 cursor-pointer items-center gap-2">
                    <RadioGroupItem value="scheduled" />
                    {t("sendLater")}
                  </Label>
                  {scheduleMode === "scheduled" && (
                    <div className="w-full sm:w-64">
                      <DateTimePicker
                        date={scheduleDate}
                        setDate={(date) => field.onChange(date ? date.toISOString() : null)}
                      />
                    </div>
                  )}
                </div>
              </RadioGroup>
              {scheduleMode === "scheduled" && (
                <p className="text-muted-foreground text-xs">{t("tzHint", { tz: timezone })}</p>
              )}
              <FormMessage />
            </FormItem>
          )}
        />
      </CardContent>
    </Card>
  );
}

const AUDIENCE_PAGE_SIZE = 8;

function audienceCriterion(filter: ContactFilterInput | undefined) {
  const industry = filter?.industry?.trim() || undefined;
  const tag = filter?.tags_any?.map((item) => item.trim()).find(Boolean);
  return { industry, tag };
}

function AudienceStep({ form, onTotalChange }: { form: Form; onTotalChange: (total: number | null) => void }) {
  const t = useTranslations("CampaignEditor");
  const tc = useTranslations("Contacts");
  const tIndustry = useTranslations("Industry");
  const common = useTranslations("Common");
  const { data: tags = [] } = useTags();
  const values = useWatch({ control: form.control }) as FormValues;
  const [page, setPage] = React.useState(1);
  const [addOpen, setAddOpen] = React.useState(false);
  const [confirmed, setConfirmed] = React.useState<{ industry?: string; tag?: string } | null>(() => {
    const saved = form.getValues("contact_filter");
    const current = audienceCriterion(saved);
    const manual = (saved?.exclude_contact_ids?.length ?? 0) + (saved?.include_contact_ids?.length ?? 0);
    const restricted = saved?.contact_ids !== undefined || saved?.tags_all?.length || saved?.domains?.length ||
      saved?.keyword || saved?.import_batch_id || saved?.exclude_domain_suspect;
    return current.industry || current.tag || manual > 0 || restricted ? current : null;
  });
  const draft = audienceCriterion(values.contact_filter);
  const criteriaChanged =
    confirmed !== null && (confirmed.industry !== draft.industry || confirmed.tag !== draft.tag);
  const filter = confirmed
    ? {
        ...values.contact_filter,
        statuses: ["active" as const],
        industry: confirmed.industry,
        tags_any: confirmed.tag ? [confirmed.tag] : []
      }
    : { statuses: ["active" as const] };
  const { data, isFetching, isLoading } = useContacts(filter, { page, page_size: AUDIENCE_PAGE_SIZE }, {
    enabled: confirmed !== null
  });
  const total = data?.total ?? 0;
  // 预览名单的 active 总数；未查询或条件已改未重查时为 null，由「下一步」实时计数。
  const knownTotal = confirmed !== null && !criteriaChanged && data ? data.total : null;
  React.useEffect(() => {
    onTotalChange(knownTotal);
  }, [knownTotal, onTotalChange]);
  const pageCount = Math.max(1, Math.ceil(total / AUDIENCE_PAGE_SIZE));
  if (data && page > pageCount) setPage(pageCount);

  const industries = industryOptions(tIndustry, values.contact_filter?.industry);

  function confirmSearch() {
    const next = audienceCriterion(form.getValues("contact_filter"));
    const changed = !confirmed || confirmed.industry !== next.industry || confirmed.tag !== next.tag;
    if (changed) {
      form.setValue("contact_filter.exclude_contact_ids", [], { shouldDirty: true });
      form.setValue("contact_filter.include_contact_ids", [], { shouldDirty: true });
      setPage(1);
    }
    setConfirmed(next);
  }

  function removeContact(id: string) {
    const exclude = new Set(form.getValues("contact_filter.exclude_contact_ids") ?? []);
    exclude.add(id);
    const include = (form.getValues("contact_filter.include_contact_ids") ?? []).filter((item) => item !== id);
    form.setValue("contact_filter.exclude_contact_ids", [...exclude], { shouldDirty: true });
    form.setValue("contact_filter.include_contact_ids", include, { shouldDirty: true });
  }

  function addContact(id: string) {
    const exclude = (form.getValues("contact_filter.exclude_contact_ids") ?? []).filter((item) => item !== id);
    const include = new Set(form.getValues("contact_filter.include_contact_ids") ?? []);
    include.add(id);
    form.setValue("contact_filter.exclude_contact_ids", exclude, { shouldDirty: true });
    form.setValue("contact_filter.include_contact_ids", [...include], { shouldDirty: true });
    setPage(1);
  }

  const firstRow = total === 0 ? 0 : (page - 1) * AUDIENCE_PAGE_SIZE + 1;
  const lastRow = Math.min(page * AUDIENCE_PAGE_SIZE, total);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("audienceTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <Alert>
          <Users />
          <AlertTitle>{t("audienceTipTitle")}</AlertTitle>
          <AlertDescription>{t("audienceTipDesc")}</AlertDescription>
        </Alert>
        <div className="grid gap-4 md:grid-cols-2">
          <FormField
            control={form.control}
            name="contact_filter.industry"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{tc("industry")}</FormLabel>
                <Select
                  value={canonicalIndustry(field.value ?? "") || "all"}
                  onValueChange={(value) => field.onChange(value === "all" ? undefined : value)}
                >
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t("anyIndustry")} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="all">{t("anyIndustry")}</SelectItem>
                    {industries.map(({ value, label }) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="contact_filter.tags_any"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("audienceTag")}</FormLabel>
                <Select
                  value={field.value?.[0] ?? "all"}
                  onValueChange={(value) => field.onChange(value === "all" ? [] : [value])}
                >
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t("audienceTagPh")} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="all">{t("anyTag")}</SelectItem>
                    {tags.map((tag) => (
                      <SelectItem key={tag.id} value={tag.name}>
                        {t("tagCount", { name: tag.name, count: tag.contact_count })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <p className="text-muted-foreground text-xs">{t("audienceActiveOnly")}</p>
        {(confirmed === null || criteriaChanged) && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-muted-foreground text-sm">
              {confirmed === null ? t("searchPending") : t("criteriaChanged")}
            </p>
            <Button type="button" onClick={confirmSearch}>
              <Search />
              {criteriaChanged ? t("confirmSearchAgain") : t("confirmSearch")}
            </Button>
          </div>
        )}
        {confirmed && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">{t("searchResults")}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => setAddOpen(true)}>
              <Plus />
              {t("addContact")}
            </Button>
          </div>
          <AddContactDialog open={addOpen} onOpenChange={setAddOpen} onAdd={addContact} />
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tc("email")}</TableHead>
                  <TableHead>{tc("name")}</TableHead>
                  <TableHead>{tc("company")}</TableHead>
                  <TableHead>{tc("industry")}</TableHead>
                  <TableHead>{tc("tags")}</TableHead>
                  <TableHead className="w-12">
                    <span className="sr-only">{t("removeContact")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <Skeleton className="h-16 w-full" />
                    </TableCell>
                  </TableRow>
                ) : total === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-muted-foreground py-8 text-center text-sm">
                      {t("audienceEmpty")}
                    </TableCell>
                  </TableRow>
                ) : (
                  data?.items.map((contact) => (
                    <TableRow key={contact.id}>
                      <TableCell className="max-w-48 truncate font-medium">{contact.email}</TableCell>
                      <TableCell>{contact.name ?? "—"}</TableCell>
                      <TableCell>{contact.company ?? "—"}</TableCell>
                      <TableCell>{contact.custom_fields.industry || "—"}</TableCell>
                      <TableCell>
                        {contact.tags.length === 0 ? (
                          "—"
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {contact.tags.slice(0, 3).map((tag) => (
                              <Badge key={tag} variant="outline">
                                {tag}
                              </Badge>
                            ))}
                            {contact.tags.length > 3 && <Badge variant="secondary">+{contact.tags.length - 3}</Badge>}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={t("removeContact")}
                          onClick={() => removeContact(contact.id)}
                        >
                          <Trash2 />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            {total > 0 && (
              <div className="flex items-center justify-between gap-3 border-t px-3 py-2" aria-busy={isFetching}>
                <span className="text-muted-foreground text-sm tabular-nums">
                  {t("audienceRange", { first: firstRow, last: lastRow, total })}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    disabled={page <= 1}
                  >
                    <span className="sr-only">{common("prevPage")}</span>
                    <ChevronLeft />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
                    disabled={page >= pageCount}
                  >
                    <span className="sr-only">{common("nextPage")}</span>
                    <ChevronRight />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
        )}
      </CardContent>
    </Card>
  );
}

function AddContactDialog({
  open,
  onOpenChange,
  onAdd
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (id: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {open && <AddContactDialogBody onAdd={onAdd} />}
      </DialogContent>
    </Dialog>
  );
}

function AddContactDialogBody({ onAdd }: { onAdd: (id: string) => void }) {
  const t = useTranslations("CampaignEditor");
  const [keyword, setKeyword] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [added, setAdded] = React.useState<string[]>([]);
  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(keyword.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [keyword]);
  const { data, isFetching } = useContacts(
    { statuses: ["active"], ...(debounced ? { keyword: debounced } : {}) },
    { page: 1, page_size: 8 }
  );
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("addContact")}</DialogTitle>
        <DialogDescription>{t("addContactDesc")}</DialogDescription>
      </DialogHeader>
      <Input
        value={keyword}
        onChange={(event) => setKeyword(event.target.value)}
        placeholder={t("addContactPh")}
        aria-label={t("addContact")}
      />
      {isFetching && !data ? (
        <Skeleton className="h-10 w-full" />
      ) : data && data.items.length > 0 ? (
        <ul className="divide-y">
          {data.items.map((contact: ContactDto) => {
            const already = added.includes(contact.id);
            return (
              <li key={contact.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 truncate text-sm">
                  <span className="font-medium">{contact.email}</span>
                  {contact.name ? <span className="text-muted-foreground"> · {contact.name}</span> : null}
                  {contact.company ? <span className="text-muted-foreground"> · {contact.company}</span> : null}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={already}
                  onClick={() => {
                    onAdd(contact.id);
                    setAdded((current) => [...current, contact.id]);
                  }}
                >
                  <Plus />
                  {already ? t("addedContact") : t("add")}
                </Button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">{t("addContactEmpty")}</p>
      )}
    </>
  );
}

function ContentStep({
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
  return <ComposePanel form={form} campaign={campaign} campaignId={campaignId} onAutosave={onAutosave} />;
}
