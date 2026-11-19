import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SettingsBody, SettingsDto, SignatureBody, SignatureDto, TemplateBody, TemplateDto } from "@mailqivo/shared";
import { apiFetch } from "@/lib/api/client";

function contentHooks<Resource, Body>(key: string, path: string) {
  return {
    useList: () => useQuery({ queryKey: [key], queryFn: () => apiFetch<{ items: Resource[] }>(path), select: (data) => data.items }),
    useCreate: () => {
      const qc = useQueryClient();
      return useMutation({
        mutationFn: (body: Body) => apiFetch<Resource>(path, { method: "POST", body: JSON.stringify(body) }),
        onSuccess: () => qc.invalidateQueries({ queryKey: [key] })
      });
    },
    useUpdate: () => {
      const qc = useQueryClient();
      return useMutation({
        mutationFn: ({ id, body }: { id: string; body: Body }) => apiFetch<Resource>(`${path}/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
        onSuccess: () => qc.invalidateQueries({ queryKey: [key] })
      });
    },
    useDelete: () => {
      const qc = useQueryClient();
      return useMutation({
        mutationFn: (id: string) => apiFetch<{ ok: true }>(`${path}/${id}`, { method: "DELETE" }),
        onSuccess: () => qc.invalidateQueries({ queryKey: [key] })
      });
    }
  };
}

export const templateApi = contentHooks<TemplateDto, TemplateBody>("templates", "/api/templates");
export const signatureApi = contentHooks<SignatureDto, SignatureBody>("signatures", "/api/signatures");

export function useSettings() {
  return useQuery({ queryKey: ["settings"], queryFn: () => apiFetch<SettingsDto>("/api/settings") });
}
export function usePatchSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<SettingsBody>) => apiFetch<SettingsDto>("/api/settings", { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: (data) => qc.setQueryData(["settings"], data)
  });
}
