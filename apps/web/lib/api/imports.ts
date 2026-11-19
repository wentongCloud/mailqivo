import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  ConfirmChallenge,
  FieldMapping,
  ImportCommitBody,
  ImportCommitResult,
  ImportCommitSummary,
  ImportPreviewResult
} from "@mailqivo/shared";
import { apiFetch } from "@/lib/api/client";
import { contactKeys } from "@/lib/api/contacts";
import { tagKeys } from "@/lib/api/tags";

export function useCreateImport() {
  return useMutation({
    mutationFn: ({ file, field_mapping }: { file: File; field_mapping?: FieldMapping }) => {
      const body = new FormData();
      body.append("file", file);
      if (field_mapping) body.append("field_mapping", JSON.stringify(field_mapping));
      return apiFetch<ImportPreviewResult>("/api/imports", { method: "POST", body });
    }
  });
}

export function useUpdateImportMapping() {
  return useMutation({
    mutationFn: ({ batch_id, field_mapping }: { batch_id: string; field_mapping: FieldMapping }) =>
      apiFetch<ImportPreviewResult>(`/api/imports/${batch_id}/mapping`, {
        method: "PUT",
        body: JSON.stringify(field_mapping)
      })
  });
}

export type ImportCommitResponse = ConfirmChallenge<ImportCommitSummary> | ImportCommitResult;

export function useCommitImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ batch_id, body }: { batch_id: string; body: ImportCommitBody }) =>
      apiFetch<ImportCommitResponse>(`/api/imports/${batch_id}/commit`, {
        method: "POST",
        body: JSON.stringify(body)
      }),
    onSuccess: (result) => {
      if (!("requires_confirmation" in result)) {
        qc.invalidateQueries({ queryKey: contactKeys.all });
        qc.invalidateQueries({ queryKey: tagKeys.all });
      }
    }
  });
}
