import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChannelBody, ChannelDto, ChannelVerifyResult } from "@mailqivo/shared";
import { apiFetch } from "@/lib/api/client";

const key = "channels";
const path = "/api/channels";

export function useChannels() {
  return useQuery({
    queryKey: [key],
    queryFn: () => apiFetch<{ items: ChannelDto[] }>(path),
    select: (data) => data.items
  });
}

export function useCreateChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ChannelBody) => apiFetch<ChannelDto>(path, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [key] })
  });
}

export function useUpdateChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ChannelBody }) => apiFetch<ChannelDto>(`${path}/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [key] })
  });
}

export function useDeleteChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<{ ok: true }>(`${path}/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [key] })
  });
}

export function useVerifyChannel() {
  return useMutation({
    mutationFn: (id: string) => apiFetch<ChannelVerifyResult>(`${path}/${id}/verify`, { method: "POST" })
  });
}
