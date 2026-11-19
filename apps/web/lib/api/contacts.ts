import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import {
  CreateContactBody,
  contactFilterToSearchParams,
  type ConfirmChallenge,
  type ContactDeleteBody,
  type ContactDeleteResult,
  type ContactDeleteSummary,
  type ContactDto,
  type ContactFilterInput,
  type ContactLanguageBody,
  type ContactLanguageResult,
  type ContactStatusBody,
  type ContactStatusResult,
  type ContactStatusSummary,
  type ContactTagsBody,
  type ContactTagsResult,
  type Paginated,
  type UpdateContactBody
} from "@mailqivo/shared";
import { apiFetch } from "@/lib/api/client";
import { tagKeys } from "@/lib/api/tags";

export const contactKeys = { all: ["contacts"] as const };

/** ContactFilter → query string（数组用重复 key，见 shared 的 contactFilterToSearchParams） */
export function contactsQueryString(
  filter: ContactFilterInput,
  page?: { page: number; page_size: number }
): string {
  const params = contactFilterToSearchParams(filter);
  if (page) {
    params.set("page", String(page.page));
    params.set("page_size", String(page.page_size));
  }
  return params.toString();
}

/** 导出地址：直接用于 <a href download>，浏览器自带 Cookie。 */
export function contactsExportUrl(filter: ContactFilterInput): string {
  return `/api/contacts/export.xlsx?${contactsQueryString(filter)}`;
}

/** GET /api/contacts（分页 + ContactFilter） */
export function useContacts(
  filter: ContactFilterInput,
  page: { page: number; page_size: number },
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: [...contactKeys.all, "list", contactsQueryString(filter, page)],
    queryFn: () => apiFetch<Paginated<ContactDto>>(`/api/contacts?${contactsQueryString(filter, page)}`),
    placeholderData: keepPreviousData,
    enabled: options?.enabled ?? true
  });
}

function useInvalidateContacts() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: contactKeys.all });
    qc.invalidateQueries({ queryKey: tagKeys.all });
  };
}

export function useCreateContact() {
  const invalidate = useInvalidateContacts();
  return useMutation({
    mutationFn: (body: CreateContactInput) =>
      apiFetch<ContactDto>("/api/contacts", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: invalidate
  });
}
type CreateContactInput = z.input<typeof CreateContactBody>;

export function useUpdateContact() {
  const invalidate = useInvalidateContacts();
  return useMutation({
    mutationFn: (v: { id: string; body: UpdateContactBody }) =>
      apiFetch<ContactDto>(`/api/contacts/${v.id}`, { method: "PATCH", body: JSON.stringify(v.body) }),
    onSuccess: invalidate
  });
}

export function useDeleteContact() {
  const invalidate = useInvalidateContacts();
  return useMutation({
    mutationFn: (id: string) => apiFetch<{ ok: true }>(`/api/contacts/${id}`, { method: "DELETE" }),
    onSuccess: invalidate
  });
}

/** POST /api/contacts/tags：批量打标签 / 去标签 */
export function useApplyContactTags() {
  const invalidate = useInvalidateContacts();
  return useMutation({
    mutationFn: (body: ContactTagsBody) =>
      apiFetch<ContactTagsResult>("/api/contacts/tags", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: invalidate
  });
}

export type ContactStatusResponse = ConfirmChallenge<ContactStatusSummary> | ContactStatusResult;

export function isConfirmChallenge(res: ContactStatusResponse): res is ConfirmChallenge<ContactStatusSummary> {
  return "requires_confirmation" in res;
}

/**
 * POST /api/contacts/status：两步确认。不带 confirm_token 返回 ConfirmChallenge（用 isConfirmChallenge 判断），
 * 带上 token 再调用一次才真正执行并返回 { updated, unchanged }。
 */
export function useUpdateContactStatus() {
  const invalidate = useInvalidateContacts();
  return useMutation({
    mutationFn: (body: ContactStatusBody) =>
      apiFetch<ContactStatusResponse>("/api/contacts/status", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (res) => {
      if (!isConfirmChallenge(res)) invalidate();
    }
  });
}

export type ContactDeleteResponse = ConfirmChallenge<ContactDeleteSummary> | ContactDeleteResult;

export function isDeleteChallenge(res: ContactDeleteResponse): res is ConfirmChallenge<ContactDeleteSummary> {
  return "requires_confirmation" in res;
}

/** POST /api/contacts/delete：两步确认后才删除。 */
export function useDeleteContacts() {
  const invalidate = useInvalidateContacts();
  return useMutation({
    mutationFn: (body: ContactDeleteBody) =>
      apiFetch<ContactDeleteResponse>("/api/contacts/delete", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (res) => {
      if (!isDeleteChallenge(res)) invalidate();
    }
  });
}

/** POST /api/contacts/language：批量设置语言偏好。 */
export function useUpdateContactLanguage() {
  const invalidate = useInvalidateContacts();
  return useMutation({
    mutationFn: (body: ContactLanguageBody) =>
      apiFetch<ContactLanguageResult>("/api/contacts/language", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: invalidate
  });
}
