import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TagDto } from "@mailqivo/shared";
import { apiFetch } from "@/lib/api/client";

export const tagKeys = { all: ["tags"] as const };

/** GET /api/tags → 全部标签（含 contact_count），按名称排序 */
export function useTags() {
  return useQuery({
    queryKey: tagKeys.all,
    queryFn: () => apiFetch<{ items: TagDto[] }>("/api/tags"),
    select: (data) => data.items
  });
}

export function useCreateTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      apiFetch<TagDto>("/api/tags", { method: "POST", body: JSON.stringify({ name }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: tagKeys.all })
  });
}

export function useRenameTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; name: string }) =>
      apiFetch<TagDto>(`/api/tags/${v.id}`, { method: "PATCH", body: JSON.stringify({ name: v.name }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: tagKeys.all });
      qc.invalidateQueries({ queryKey: ["contacts"] });
    }
  });
}

export function useDeleteTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<{ ok: true }>(`/api/tags/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: tagKeys.all });
      qc.invalidateQueries({ queryKey: ["contacts"] });
    }
  });
}
