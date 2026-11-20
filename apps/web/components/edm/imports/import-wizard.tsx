"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Download, FileSpreadsheet, UploadCloud } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  IMPORT_ISSUE_VALUES,
  type ConfirmChallenge,
  type DedupStrategy,
  type ImportCommitSummary
} from "@mailqivo/shared";
import { useLocalizedLabels } from "@/hooks/use-app-locale";
import { ApiError } from "@/lib/api/client";
import { useCommitImport, useCreateImport, useUpdateImportMapping } from "@/lib/api/imports";
import { useTags } from "@/lib/api/tags";
import { useImportStore } from "./import-store";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function ImportWizard() {
  const t = useTranslations("Import");
  const { step, preview, setStep, reset } = useImportStore();
  const steps = [t("stepUpload"), t("stepMapping"), t("stepCommit")];
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("pageTitle")}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t("pageDesc")}</p>
      </div>
      <ol className="grid grid-cols-3 gap-2">
        {steps.map((label, index) => (
          <li
            key={label}
            className={`flex items-center gap-2 text-sm ${step >= index + 1 ? "text-foreground" : "text-muted-foreground"}`}
          >
            <span
              className={`flex size-6 shrink-0 items-center justify-center rounded-full border ${step > index + 1 ? "bg-primary text-primary-foreground" : ""}`}
            >
              {step > index + 1 ? <Check className="size-3.5" /> : index + 1}
            </span>
            <span className="truncate">{label}</span>
          </li>
        ))}
      </ol>
      {step === 1 && <UploadStep />}
      {step === 2 && preview && <MappingStep />}
      {step === 3 && preview && <CommitStep onReset={reset} onBack={() => setStep(2)} />}
    </div>
  );
}

function UploadStep() {
  const t = useTranslations("Import");
  const mutation = useCreateImport();
  const setPreview = useImportStore((state) => state.setPreview);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function upload(file?: File) {
    if (!file) return;
    setError(null);
    if (!/\.(xlsx|csv)$/i.test(file.name)) {
      setError(t("badFile"));
      return;
    }
    try {
      setPreview(await mutation.mutateAsync({ file }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("uploadFail"));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("uploadTitle")}</CardTitle>
        <CardDescription>{t("uploadDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          className={`flex min-h-64 flex-col items-center justify-center rounded-lg border border-dashed p-6 text-center transition-colors ${dragging ? "border-primary bg-primary/5" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void upload(event.dataTransfer.files[0]);
          }}
        >
          <UploadCloud className="text-muted-foreground mb-4 size-10" />
          <p className="font-medium">{t("dropHint")}</p>
          <p className="text-muted-foreground mt-2 text-sm">{t("dropHint2")}</p>
          <Button
            className="mt-5"
            variant="outline"
            disabled={mutation.isPending}
            onClick={() => inputRef.current?.click()}
          >
            <FileSpreadsheet />
            {mutation.isPending ? t("parsing") : t("pickFile")}
          </Button>
          <input
            ref={inputRef}
            className="hidden"
            type="file"
            accept=".xlsx,.csv"
            onChange={(event) => void upload(event.target.files?.[0])}
          />
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

function MappingStep() {
  const t = useTranslations("Import");
  const labels = useLocalizedLabels();
  const { preview, mapping, setMapping, setPreview, setStep } = useImportStore();
  const mutation = useUpdateImportMapping();
  const [error, setError] = React.useState<string | null>(null);
  if (!preview) return null;
  const headers = Object.keys(mapping);
  const sample = preview.report.column_samples ?? {};

  async function next() {
    if (!preview) return;
    setError(null);
    try {
      const result = await mutation.mutateAsync({ batch_id: preview.batch_id, field_mapping: mapping });
      setPreview(result);
      setStep(3);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("recheckFail"));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("mappingTitle")}</CardTitle>
        <CardDescription>{t("mappingDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-3">
          {headers.map((header) => {
            const target = mapping[header] ?? "ignore";
            const selectValue = target.startsWith("custom:") ? "custom" : target;
            return (
              <div key={header} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr] sm:items-center">
                <div className="min-w-0">
                  <div className="truncate font-medium">{header}</div>
                  <div className="text-muted-foreground truncate text-xs">
                    {t("sample", { value: sample[header] || "—" })}
                  </div>
                </div>
                <Select
                  value={selectValue}
                  onValueChange={(value) =>
                    setMapping({
                      ...mapping,
                      [header]: value === "custom" ? `custom:${header}` : value
                    })
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(labels.importField).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                    <SelectItem value="custom">{t("customField", { header })}</SelectItem>
                  </SelectContent>
                </Select>
                <div className="text-muted-foreground text-xs sm:text-right">
                  {target === "ignore"
                    ? t("willNotImport")
                    : t("writeTo", {
                        field: target.startsWith("custom:")
                          ? target.slice(7)
                          : labels.importField[target]
                      })}
                </div>
              </div>
            );
          })}
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="flex justify-between">
          <Button variant="outline" onClick={() => setStep(1)}>
            {t("back")}
          </Button>
          <Button disabled={mutation.isPending} onClick={() => void next()}>
            {mutation.isPending ? t("rechecking") : t("recheck")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function CommitStep({ onBack, onReset }: { onBack: () => void; onReset: () => void }) {
  const t = useTranslations("Import");
  const tc = useTranslations("Common");
  const labels = useLocalizedLabels();
  const router = useRouter();
  const { preview, dedupStrategy, tagIds, setDedupStrategy, toggleTag } = useImportStore();
  const { data: availableTags = [] } = useTags();
  const mutation = useCommitImport();
  const [challenge, setChallenge] = React.useState<ConfirmChallenge<ImportCommitSummary> | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  if (!preview) return null;

  const strategies: { value: DedupStrategy; label: string; description: string }[] = [
    { value: "skip", label: t("skipExisting"), description: t("skipExistingDesc") },
    { value: "overwrite", label: t("overwrite"), description: t("overwriteDesc") },
    { value: "merge_tags", label: t("mergeTags"), description: t("mergeTagsDesc") }
  ];

  const body = { dedup_strategy: dedupStrategy, tag_ids: tagIds };
  async function requestConfirmation() {
    if (!preview) return;
    setError(null);
    try {
      const result = await mutation.mutateAsync({ batch_id: preview.batch_id, body });
      if ("requires_confirmation" in result) setChallenge(result);
      else finish(result.created, result.updated, result.skipped);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("importFail"));
    }
  }
  async function confirm() {
    if (!preview || !challenge) return;
    setError(null);
    try {
      const result = await mutation.mutateAsync({
        batch_id: preview.batch_id,
        body: { ...body, confirm_token: challenge.confirm_token }
      });
      if (!("requires_confirmation" in result)) {
        setChallenge(null);
        finish(result.created, result.updated, result.skipped);
      }
    } catch (err) {
      if (err instanceof ApiError && err.body.code === "CONFIRM_INVALID") {
        const details = err.body.details as
          | { summary?: ImportCommitSummary; confirm_token?: string }
          | undefined;
        if (details?.summary && details.confirm_token) {
          setChallenge({
            requires_confirmation: true,
            summary: details.summary,
            confirm_token: details.confirm_token
          });
          setError(tc("confirmAgain"));
          return;
        }
      }
      setChallenge(null);
      setError(err instanceof ApiError ? err.message : t("importFail"));
    }
  }
  function finish(created: number, updated: number, skipped: number) {
    toast.success(t("doneToast", { created, updated, skipped }));
    onReset();
    router.push("/contacts");
    router.refresh();
  }

  const issueJoin = labels.locale === "zh-CN" ? "、" : ", ";

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>{t("reportTitle")}</CardTitle>
          <CardDescription>
            {t("reportDesc", { total: preview.report.total, valid: preview.report.valid })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {IMPORT_ISSUE_VALUES.map((issue) => (
              <div key={issue} className="rounded-lg border p-3">
                <div className="text-2xl font-semibold">{preview.report.issues[issue]}</div>
                <div className="text-muted-foreground text-xs">{labels.importIssue[issue]}</div>
              </div>
            ))}
          </div>
          <Button variant="outline" asChild>
            <a href={`/api/imports/${preview.batch_id}/problem-rows.csv`} download>
              <Download />
              {t("downloadProblems")}
            </a>
          </Button>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="p-2 text-left">{t("colRow")}</th>
                  <th className="p-2 text-left">{t("colEmail")}</th>
                  <th className="p-2 text-left">{t("colName")}</th>
                  <th className="p-2 text-left">{t("colResult")}</th>
                </tr>
              </thead>
              <tbody>
                {preview.report.sample_rows.map((row) => (
                  <tr key={row.row_no} className="border-t">
                    <td className="p-2">{row.row_no}</td>
                    <td className="p-2">{row.data.email || "—"}</td>
                    <td className="p-2">{row.data.name || "—"}</td>
                    <td className="p-2">
                      {row.issues.length
                        ? row.issues.map((issue) => labels.importIssue[issue]).join(issueJoin)
                        : t("passed")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("dedupTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <RadioGroup
            value={dedupStrategy}
            onValueChange={(value) => setDedupStrategy(value as DedupStrategy)}
          >
            {strategies.map((strategy) => (
              <Label
                key={strategy.value}
                className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal"
              >
                <RadioGroupItem value={strategy.value} className="mt-0.5" />
                <span>
                  <span className="font-medium">{strategy.label}</span>
                  <span className="text-muted-foreground mt-1 block text-xs">
                    {strategy.description}
                  </span>
                </span>
              </Label>
            ))}
          </RadioGroup>
          <div>
            <Label>{t("importTags")}</Label>
            <div className="mt-2 flex flex-wrap gap-2">
              {availableTags.length ? (
                availableTags.map((tag) => (
                  <Label
                    key={tag.id}
                    className="cursor-pointer rounded-md border px-3 py-2 text-sm font-normal"
                  >
                    <input
                      type="checkbox"
                      className="accent-primary"
                      checked={tagIds.includes(tag.id)}
                      onChange={() => toggleTag(tag.id)}
                    />
                    {tag.name}
                  </Label>
                ))
              ) : (
                <span className="text-muted-foreground text-sm">{t("noTags")}</span>
              )}
            </div>
          </div>
          {error && !challenge && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="flex justify-between">
            <Button variant="outline" onClick={onBack}>
              {t("back")}
            </Button>
            <Button disabled={mutation.isPending} onClick={() => void requestConfirmation()}>
              {mutation.isPending ? t("calculating") : t("confirmImport")}
            </Button>
          </div>
        </CardContent>
      </Card>
      <AlertDialog open={challenge !== null} onOpenChange={(open) => !open && setChallenge(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("confirmDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          {challenge && (
            <div className="bg-muted/50 grid grid-cols-3 gap-2 rounded-md p-4 text-center">
              <div>
                <b className="block text-xl">{challenge.summary.created}</b>
                <span className="text-muted-foreground text-xs">{t("createdLabel")}</span>
              </div>
              <div>
                <b className="block text-xl">{challenge.summary.updated}</b>
                <span className="text-muted-foreground text-xs">{t("updatedLabel")}</span>
              </div>
              <div>
                <b className="block text-xl">{challenge.summary.skipped}</b>
                <span className="text-muted-foreground text-xs">{t("skippedLabel")}</span>
              </div>
            </div>
          )}
          {error && <p className="text-destructive text-sm">{error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={mutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                void confirm();
              }}
            >
              {mutation.isPending ? t("importing") : t("confirmRun")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
