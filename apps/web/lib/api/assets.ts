import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AssetDto } from "@mailqivo/shared";
import { apiFetch } from "@/lib/api/client";

export function useAssets() {
  return useQuery({ queryKey: ["assets"], queryFn: () => apiFetch<{ items: AssetDto[] }>("/api/assets"), select: (data) => data.items });
}

export function useUploadAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const body = new FormData();
      body.append("file", file);
      return apiFetch<AssetDto>("/api/assets", { method: "POST", body });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["assets"] })
  });
}

export function useDisableAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<AssetDto>(`/api/assets/${id}/disable`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["assets"] })
  });
}
