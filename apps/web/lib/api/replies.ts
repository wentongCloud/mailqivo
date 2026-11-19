import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InboundCategory, Paginated, ReplyCounts, ReplyDetail, ReplyListItem, ReplyPatchBody } from "@mailqivo/shared";
import { apiFetch } from "@/lib/api/client";

export type ReplyFilters = {
  campaignId?: string;
  category?: InboundCategory;
  needsReview?: boolean;
  unhandled?: boolean;
};
export type ReplyPage = Paginated<ReplyListItem> & { counts: ReplyCounts };
const all = ["replies"] as const;

export function useReplies(filters: ReplyFilters, page = 1) {
  const params = new URLSearchParams({ page: String(page), page_size: "20" });
  if (filters.campaignId) params.set("campaign_id", filters.campaignId);
  if (filters.category) params.set("category", filters.category);
  if (filters.needsReview) params.set("needs_review", "true");
  if (filters.unhandled) params.set("handled", "false");
  return useQuery({
    queryKey: [...all, "list", filters, page],
    queryFn: () => apiFetch<ReplyPage>(`/api/replies?${params}`),
    placeholderData: keepPreviousData
  });
}

export function useReply(id?: string) {
  return useQuery({ queryKey: [...all, id], queryFn: () => apiFetch<ReplyDetail>(`/api/replies/${id}`), enabled: !!id });
}

export function useUpdateReply(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ReplyPatchBody) => apiFetch<ReplyDetail>(`/api/replies/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: all })
  });
}
