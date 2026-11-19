/** §5.2 REST 约定中前后端共用的 schema 与类型。 */
import { z } from "zod";
import type { ErrorCode } from "../enums.ts";

/** 分页请求：`?page=1&page_size=20`，page_size 最大 200 */
export const PAGE_SIZE_DEFAULT = 20;
export const PAGE_SIZE_MAX = 200;

export const PaginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT)
});
export type PaginationQuery = z.infer<typeof PaginationQuery>;

/** 分页响应 */
export type Paginated<T> = {
  items: T[];
  total: number;
  page: number;
  page_size: number;
};

/**
 * 时间入参：ISO 8601，且必须带时区偏移（`Z` 或 `+08:00`）。
 * 不带偏移的输入解析失败 → 服务端返回 VALIDATION。
 */
export const IsoDateTime = z.iso.datetime({ offset: true });

/** 失败响应体（§5.2）。 */
export type ApiErrorBody = {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
};

/**
 * §5.4 两步确认的第一步响应：不执行任何写操作，返回摘要与一次性令牌。
 * 第二步带上 `confirm_token` 再次调用同一接口。
 */
export type ConfirmChallenge<S = Record<string, unknown>> = {
  requires_confirmation: true;
  confirm_token: string;
  summary: S;
};
