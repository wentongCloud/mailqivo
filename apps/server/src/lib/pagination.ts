/**
 * §5.2 分页：请求 `?page=1&page_size=20`（page_size 最大 200），响应 `{ items, total, page, page_size }`。
 */
import { PaginationQuery, type Paginated } from "@mailqivo/shared";
import { parseOrThrow } from "./errors.ts";

export type PageParams = {
  page: number;
  page_size: number;
  limit: number;
  offset: number;
};

/** 从 query 中解析分页参数（忽略其他字段）；非法时抛出 VALIDATION。 */
export function parsePagination(query: unknown): PageParams {
  const source = (query ?? {}) as Record<string, unknown>;
  const { page, page_size } = parseOrThrow(PaginationQuery, {
    page: source.page,
    page_size: source.page_size
  });
  return { page, page_size, limit: page_size, offset: (page - 1) * page_size };
}

export function toPage<T>(items: T[], total: number, params: Pick<PageParams, "page" | "page_size">): Paginated<T> {
  return { items, total, page: params.page, page_size: params.page_size };
}
