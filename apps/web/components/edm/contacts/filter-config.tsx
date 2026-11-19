import { CircleDotIcon, GlobeIcon, PackageIcon, TagIcon } from "lucide-react";
import {
  contactStatusLabelMap,
  type AppLocale,
  CONTACT_STATUS_VALUES,
  type ContactFilterInput,
  type ContactStatus,
  type TagDto
} from "@mailqivo/shared";

import { Dot } from "@/components/table-filter-helpers";
import { createFilterQuery, flattenFilterRules } from "@/components/ui/filters/filters-query";
import type { FilterField, FilterLabels, FilterQuery } from "@/components/ui/filters/filters-types";

export const EMPTY_FILTER_QUERY: FilterQuery = createFilterQuery();

const STATUS_DOT: Record<ContactStatus, string> = {
  active: "bg-emerald-500",
  invalid: "bg-rose-500",
  bounced: "bg-orange-500",
  unsubscribed: "bg-zinc-400"
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ContactFilterFieldCopy = {
  status: string;
  isAnyOf: string;
  tags: string;
  hasAnyOf: string;
  hasAllOf: string;
  domain: string;
  domainPh: string;
  is: string;
  importBatch: string;
  batchIdPh: string;
  batchIdInvalid: string;
};

const DEFAULT_FIELD_COPY: Record<AppLocale, ContactFilterFieldCopy> = {
  "en-GB": {
    status: "Status",
    isAnyOf: "is any of",
    tags: "Tags",
    hasAnyOf: "has any of",
    hasAllOf: "has all of",
    domain: "Domain",
    domainPh: "e.g. example.com",
    is: "is",
    importBatch: "Import batch",
    batchIdPh: "Batch ID",
    batchIdInvalid: "Invalid batch ID"
  },
  "zh-CN": {
    status: "状态",
    isAnyOf: "属于",
    tags: "标签",
    hasAnyOf: "包含任一",
    hasAllOf: "包含全部",
    domain: "域名",
    domainPh: "例如 example.com",
    is: "为",
    importBatch: "导入批次",
    batchIdPh: "批次 ID",
    batchIdInvalid: "批次 ID 格式不正确"
  }
};

/** 筛选字段：id 与 ContactFilter 的字段一一对应（见 queryToContactFilter）。 */
export function buildContactFilterFields(
  tags: TagDto[],
  locale: AppLocale = "en-GB",
  copy: ContactFilterFieldCopy = DEFAULT_FIELD_COPY[locale]
): FilterField[] {
  const statusLabels = contactStatusLabelMap(locale);
  return [
    {
      id: "statuses",
      label: copy.status,
      type: "select",
      icon: <CircleDotIcon />,
      searchable: false,
      operators: [{ value: "is_any_of", label: copy.isAnyOf, arity: "many" }],
      defaultOperator: "is_any_of",
      options: CONTACT_STATUS_VALUES.map((s) => ({
        value: s,
        label: statusLabels[s],
        icon: <Dot className={STATUS_DOT[s]} />
      }))
    },
    {
      id: "tags",
      label: copy.tags,
      type: "multiselect",
      icon: <TagIcon />,
      operators: [
        { value: "has_any_of", label: copy.hasAnyOf, arity: "many" },
        { value: "has_all_of", label: copy.hasAllOf, arity: "many" }
      ],
      defaultOperator: "has_any_of",
      options: tags.map((tag) => ({ value: tag.name, label: tag.name }))
    },
    {
      id: "domains",
      label: copy.domain,
      type: "text",
      icon: <GlobeIcon />,
      placeholder: copy.domainPh,
      operators: [{ value: "is", label: copy.is, arity: "one" }],
      defaultOperator: "is"
    },
    {
      id: "import_batch_id",
      label: copy.importBatch,
      type: "text",
      icon: <PackageIcon />,
      // SPEC-GAP: 导入批次列表接口随 T03 提供；此前先按批次 ID（uuid）筛选。
      placeholder: copy.batchIdPh,
      operators: [{ value: "is", label: copy.is, arity: "one" }],
      defaultOperator: "is",
      validate: ({ value }) =>
        typeof value === "string" && !UUID_RE.test(value.trim()) ? copy.batchIdInvalid : null
    }
  ];
}

const asList = (v: unknown): string[] =>
  (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]).map(String).filter(Boolean);

/**
 * 筛选构建器的 query + 工具栏输入 → ContactFilter。
 * 未选状态时查询全部四种状态（通讯录要能看到全部联系人；服务端默认只含 active）。
 */
export function queryToContactFilter(
  query: FilterQuery,
  extra: { keyword: string; excludeDomainSuspect: boolean }
): ContactFilterInput {
  const filter: ContactFilterInput = {
    statuses: [...CONTACT_STATUS_VALUES],
    exclude_domain_suspect: extra.excludeDomainSuspect
  };
  const keyword = extra.keyword.trim();
  if (keyword) filter.keyword = keyword;

  const tagsAny: string[] = [];
  const tagsAll: string[] = [];
  const domains: string[] = [];
  const statuses: ContactStatus[] = [];
  for (const rule of flattenFilterRules(query)) {
    const values = asList(rule.value);
    if (values.length === 0) continue;
    switch (rule.path[0]) {
      case "statuses":
        statuses.push(...(values as ContactStatus[]));
        break;
      case "tags":
        (rule.operator === "has_all_of" ? tagsAll : tagsAny).push(...values);
        break;
      case "domains":
        domains.push(...values);
        break;
      case "import_batch_id":
        if (UUID_RE.test(values[0]!.trim())) filter.import_batch_id = values[0]!.trim();
        break;
    }
  }
  if (statuses.length) filter.statuses = [...new Set(statuses)];
  if (tagsAny.length) filter.tags_any = tagsAny;
  if (tagsAll.length) filter.tags_all = tagsAll;
  if (domains.length) filter.domains = domains;
  return filter;
}

/** 构建器界面文案（按 locale）。未列出的键沿用组件默认英文。 */
export function filterBuilderLabels(locale: AppLocale): Partial<FilterLabels> {
  if (locale === "zh-CN") {
    return {
      addFilter: "添加筛选",
      clearAll: "清除全部",
      clear: "清除",
      apply: "应用",
      back: "返回",
      discard: "放弃修改",
      empty: "没有结果",
      loading: "加载中…",
      where: "当",
      and: "且",
      or: "或",
      remove: "移除",
      duplicate: "复制",
      searchFields: "搜索字段…",
      searchOperators: "搜索条件…",
      searchOptions: "搜索…",
      valuePlaceholder: "输入内容…",
      selectPlaceholder: "请选择…",
      noValue: "未设置",
      retry: "重试",
      error: "加载失败",
      filtersLabel: "筛选",
      fieldsLabel: "字段",
      valueCount: (count) => `已选 ${count} 项`,
      itemCount: (count) => `${count} 项`
    };
  }
  return {
    addFilter: "Add filter",
    clearAll: "Clear all",
    clear: "Clear",
    apply: "Apply",
    back: "Back",
    discard: "Discard",
    empty: "No results",
    loading: "Loading…",
    where: "Where",
    and: "And",
    or: "Or",
    remove: "Remove",
    duplicate: "Duplicate",
    searchFields: "Search fields…",
    searchOperators: "Search operators…",
    searchOptions: "Search…",
    valuePlaceholder: "Enter a value…",
    selectPlaceholder: "Select…",
    noValue: "Not set",
    retry: "Retry",
    error: "Failed to load",
    filtersLabel: "Filters",
    fieldsLabel: "Fields",
    valueCount: (count) => `${count} selected`,
    itemCount: (count) => `${count} items`
  };
}

/** @deprecated use filterBuilderLabels(locale) */
export const FILTER_LABELS_ZH = filterBuilderLabels("zh-CN");
