import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ConfirmChallenge, UpdateCheck, UpdateSummary, UpdateTaskStatus } from "@mailqivo/shared";
import { ApiError, apiFetch } from "@/lib/api/client";

export type UpdateConfirmResponse = ConfirmChallenge<UpdateSummary> | { task_id: string };

const ACTIVE: UpdateTaskStatus["state"][] = ["queued", "running"];
export const isTaskActive = (task?: UpdateTaskStatus | null) => !!task && ACTIVE.includes(task.state);

/** 键含当前任务状态：任务结束（状态变化）时自动重新检查；保留上一结果，避免显示闪烁。 */
export function useUpdateCheck(taskState?: UpdateTaskStatus["state"]) {
  return useQuery({ queryKey: ["update-check", taskState ?? null], queryFn: () => apiFetch<UpdateCheck>("/api/system/update"), placeholderData: keepPreviousData });
}

/** 任务进行中每 2 秒刷新；服务重启期间请求失败会持续重试，直到重新连上（版本更新 §6）。 */
export function useUpdateTask(id: string | null) {
  return useQuery({
    queryKey: ["update-task", id],
    queryFn: () => apiFetch<UpdateTaskStatus>(`/api/system/update/tasks/${id}`),
    enabled: !!id,
    refetchInterval: (query) => (isTaskActive(query.state.data) || query.state.fetchFailureCount > 0 ? 2000 : false),
    retry: (_count, error) => !(error instanceof ApiError && error.status === 404),
    retryDelay: 2000
  });
}

export function useConfirmUpdate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (confirm_token?: string) =>
      apiFetch<UpdateConfirmResponse>("/api/system/update", { method: "POST", body: JSON.stringify(confirm_token ? { confirm_token } : {}) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["update-check"] })
  });
}
