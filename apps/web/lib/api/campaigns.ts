import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CampaignBody, CampaignDto, CampaignPreviewBody, CampaignPreviewItem, CampaignListDto, CampaignMessageDto, CampaignOpensByHour, CampaignSendBody, CampaignSendSummary, CampaignStats, CampaignTestSendBody, CampaignTestSendResult, ConfirmChallenge, MessageStatus, Paginated, RequeueUnknownBody, RequeueUnknownResult, RequeueUnknownSummary } from "@mailqivo/shared";
import { apiFetch } from "@/lib/api/client";

const all = ["campaigns"] as const;
export type CampaignSendResponse = ConfirmChallenge<CampaignSendSummary> | CampaignDto;
export type CampaignCancelResponse = ConfirmChallenge<{ queued_messages: number }> | CampaignDto;
export type RequeueUnknownResponse = ConfirmChallenge<RequeueUnknownSummary> | RequeueUnknownResult;

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: all });
}

export function useCampaigns(page = 1) {
  return useQuery({
    queryKey: [...all, "list", page],
    queryFn: () => apiFetch<Paginated<CampaignListDto>>(`/api/campaigns?page=${page}&page_size=20`),
    placeholderData: keepPreviousData
  });
}

export function useCampaign(id?: string) {
  return useQuery({ queryKey: [...all, id], queryFn: () => apiFetch<CampaignDto>(`/api/campaigns/${id}`), enabled: !!id });
}

export function useCampaignStats(id?: string, live = false) {
  return useQuery({
    queryKey: [...all, id, "stats"],
    queryFn: () => apiFetch<CampaignStats>(`/api/campaigns/${id}/stats`),
    enabled: !!id,
    refetchInterval: live ? 10_000 : false
  });
}

export function useCampaignOpens(id?: string) {
  return useQuery({
    queryKey: [...all, id, "opens-by-hour"],
    queryFn: () => apiFetch<CampaignOpensByHour>(`/api/campaigns/${id}/stats/opens-by-hour`),
    enabled: !!id
  });
}

export function useCampaignMessages(id: string | undefined, page: number, status?: MessageStatus) {
  const suffix = status ? `&status=${status}` : "";
  return useQuery({
    queryKey: [...all, id, "messages", page, status],
    queryFn: () => apiFetch<Paginated<CampaignMessageDto>>(`/api/campaigns/${id}/messages?page=${page}&page_size=20${suffix}`),
    enabled: !!id,
    placeholderData: keepPreviousData
  });
}

export function useCreateCampaign() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: CampaignBody) => apiFetch<CampaignDto>("/api/campaigns", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: invalidate
  });
}

export function useUpdateCampaign() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: CampaignBody }) => apiFetch<CampaignDto>(`/api/campaigns/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: invalidate
  });
}

export function useDeleteCampaign() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => apiFetch<{ ok: true }>(`/api/campaigns/${id}`, { method: "DELETE" }),
    onSuccess: invalidate
  });
}

export function useSendCampaign(id: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: CampaignSendBody) => apiFetch<CampaignSendResponse>(`/api/campaigns/${id}/send`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: invalidate
  });
}

export function useTestSendCampaign(id: string) {
  return useMutation({
    mutationFn: (body: CampaignTestSendBody) => apiFetch<CampaignTestSendResult>(`/api/campaigns/${id}/test-send`, { method: "POST", body: JSON.stringify(body) })
  });
}

export function useCampaignAction(id: string, action: "pause" | "resume" | "cancel") {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: { confirm_token?: string } = {}) => apiFetch<CampaignCancelResponse>(`/api/campaigns/${id}/${action}`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: invalidate
  });
}

/** §6.3 unknown 人工回收（两步确认）。 */
export function useRequeueUnknown(id: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: RequeueUnknownBody) => apiFetch<RequeueUnknownResponse>(`/api/campaigns/${id}/messages/requeue-unknown`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: invalidate
  });
}

/** 按一句要求改写当前正文。未配置语言模型时服务端返回 AI_DISABLED。 */
export function useImproveDraft() {
  return useMutation({
    mutationFn: (body: { html: string; instruction: string }) =>
      apiFetch<{ html: string }>("/api/campaigns/improve-draft", { method: "POST", body: JSON.stringify(body) })
  });
}

/** §8.3 生成样例（写入 ai_cache，影响发送摘要的 sample_confirmed）。 */
export function usePreviewCampaign() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, body = {} }: { id: string; body?: Partial<CampaignPreviewBody> }) => apiFetch<CampaignPreviewItem[]>(`/api/campaigns/${id}/preview`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: invalidate
  });
}
