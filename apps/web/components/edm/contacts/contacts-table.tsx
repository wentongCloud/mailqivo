"use client";

import * as React from "react";
import Link from "next/link";
import { format } from "date-fns";
import { flexRender } from "@tanstack/react-table";
import { useLocalizedLabels } from "@/hooks/use-app-locale";
import {
  type LegacyColumnDef as ColumnDef,
  getCoreRowModel,
  useLegacyTable as useReactTable
} from "@tanstack/react-table/legacy";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  LanguagesIcon,
  ListFilterIcon,
  MoreHorizontalIcon,
  PlusIcon,
  SearchIcon,
  TagIcon,
  TagsIcon,
  Trash2Icon,
  TriangleAlertIcon,
  UserRoundCheckIcon,
  UsersIcon
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import type { RowSelectionState } from "@tanstack/table-core";
import { consentSourceLabelI18n, type ContactDto } from "@mailqivo/shared";

import { ApiError } from "@/lib/api/client";
import { contactsExportUrl, useContacts, useDeleteContact } from "@/lib/api/contacts";
import { useTags } from "@/lib/api/tags";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Filters } from "@/components/ui/filters/filters";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { FilterQuery } from "@/components/ui/filters/filters-types";
import { CITY_KEYS, COUNTRY_KEYS, ContactFormDialog, LANGUAGE_KEYS, readProfileField } from "./contact-form-dialog";
import { ContactStatusBadge } from "./contact-status-badge";
import {
  buildContactFilterFields,
  EMPTY_FILTER_QUERY,
  filterBuilderLabels,
  queryToContactFilter
} from "./filter-config";
import { StatusChangeDialog, type ManualStatus } from "./status-change-dialog";
import { DeleteBatchDialog } from "./delete-batch-dialog";
import { LanguageBatchDialog } from "./language-batch-dialog";
import { TagBatchDialog } from "./tag-batch-dialog";
import { TagManagerDialog } from "./tag-manager-dialog";

/** 选中联系人导出时 contact_ids 放在 query 里，过多会超出 URL 长度限制。 */
const MAX_EXPORT_SELECTED = 300;
const PAGE_SIZES = [20, 50, 100];

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export default function ContactsTable() {
  const t = useTranslations("Contacts");
  const tc = useTranslations("Common");
  const labels = useLocalizedLabels();
  const formatTime = (iso: string) => format(new Date(iso), "yyyy-MM-dd HH:mm", { locale: labels.dateLocale });
  const [keywordInput, setKeywordInput] = React.useState("");
  const keyword = useDebounced(keywordInput, 300);
  const [query, setQuery] = React.useState<FilterQuery>(EMPTY_FILTER_QUERY);
  const [excludeSuspect, setExcludeSuspect] = React.useState(false);
  const [pageSize, setPageSize] = React.useState(20);
  // 页码与选择都绑定到“当前筛选条件”：筛选一变就自动回到第一页并清空选择（避免对已看不到的联系人误操作）
  const [pageState, setPageState] = React.useState({ key: "", page: 1 });
  const [selectionState, setSelectionState] = React.useState<{ key: string; rows: RowSelectionState }>({
    key: "",
    rows: {}
  });

  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<ContactDto | undefined>();
  const [deleting, setDeleting] = React.useState<ContactDto | null>(null);
  const [tagManagerOpen, setTagManagerOpen] = React.useState(false);
  const [tagBatchOpen, setTagBatchOpen] = React.useState(false);
  const [statusTarget, setStatusTarget] = React.useState<ManualStatus | null>(null);
  const [deleteBatchOpen, setDeleteBatchOpen] = React.useState(false);
  const [languageBatchOpen, setLanguageBatchOpen] = React.useState(false);

  const { data: tags = [] } = useTags();
  const fields = React.useMemo(() => buildContactFilterFields(tags, labels.locale), [tags, labels.locale]);
  const filterUiLabels = React.useMemo(() => filterBuilderLabels(labels.locale), [labels.locale]);
  const filter = React.useMemo(
    () => queryToContactFilter(query, { keyword, excludeDomainSuspect: excludeSuspect }),
    [query, keyword, excludeSuspect]
  );

  const filterKey = JSON.stringify(filter);
  const pageIndex = pageState.key === filterKey ? pageState.page : 1;
  const setPageIndex = (next: number | ((p: number) => number)) =>
    setPageState({ key: filterKey, page: typeof next === "function" ? next(pageIndex) : next });
  const rowSelection = selectionState.key === filterKey ? selectionState.rows : {};
  const setRowSelection = (
    next: RowSelectionState | ((old: RowSelectionState) => RowSelectionState)
  ) =>
    setSelectionState({
      key: filterKey,
      rows: typeof next === "function" ? next(rowSelection) : next
    });

  const { data, isLoading, isError, error, isFetching } = useContacts(filter, {
    page: pageIndex,
    page_size: pageSize
  });
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const columns = React.useMemo<ColumnDef<ContactDto>[]>(
    () => [
      {
        id: "select",
        header: ({ table }) => (
          <Checkbox
            checked={
              table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && "indeterminate")
            }
            onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
            aria-label={t("selectPage")}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            aria-label={t("selectRow")}
          />
        )
      },
      {
        id: "email",
        header: () => t("email"),
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-medium">{row.original.email}</span>
            {row.original.domain_suspect && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <TriangleAlertIcon className="size-3.5 shrink-0 text-orange-500" aria-label={t("domainSuspect")} />
                </TooltipTrigger>
                <TooltipContent>{t("domainSuspectTip")}</TooltipContent>
              </Tooltip>
            )}
          </div>
        )
      },
      { id: "name", header: () => t("name"), cell: ({ row }) => row.original.name ?? <Muted /> },
      { id: "company", header: () => t("company"), cell: ({ row }) => row.original.company ?? <Muted /> },
      {
        id: "country",
        header: () => t("country"),
        cell: ({ row }) => readProfileField(row.original.custom_fields, COUNTRY_KEYS) || <Muted />
      },
      {
        id: "city",
        header: () => t("city"),
        cell: ({ row }) => readProfileField(row.original.custom_fields, CITY_KEYS) || <Muted />
      },
      {
        id: "language",
        header: () => t("language"),
        cell: ({ row }) => readProfileField(row.original.custom_fields, LANGUAGE_KEYS) || <Muted />
      },
      {
        id: "tags",
        header: () => t("tags"),
        cell: ({ row }) => {
          const list = row.original.tags;
          if (list.length === 0) return <Muted />;
          return (
            <div className="flex flex-wrap gap-1">
              {list.slice(0, 3).map((t) => (
                <Badge key={t} variant="outline">
                  {t}
                </Badge>
              ))}
              {list.length > 3 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="secondary">+{list.length - 3}</Badge>
                  </TooltipTrigger>
                  <TooltipContent>{list.slice(3).join("、")}</TooltipContent>
                </Tooltip>
              )}
            </div>
          );
        }
      },
      { id: "status", header: () => t("status"), cell: ({ row }) => <ContactStatusBadge contact={row.original} /> },
      {
        id: "consent_source",
        header: () => labels.common("consentSourceColumn"),
        cell: ({ row }) =>
          row.original.consent_source ? (
            <span className="whitespace-nowrap">{consentSourceLabelI18n(row.original.consent_source, labels.locale)}</span>
          ) : (
            <Muted />
          )
      },
      {
        id: "consent_at",
        header: () => labels.common("consentAt"),
        cell: ({ row }) =>
          row.original.consent_at ? (
            <span className="text-muted-foreground whitespace-nowrap">{formatTime(row.original.consent_at)}</span>
          ) : (
            <Muted />
          )
      },
      {
        id: "created_at",
        header: () => t("createdAt"),
        cell: ({ row }) => (
          <span className="text-muted-foreground whitespace-nowrap">{formatTime(row.original.created_at)}</span>
        )
      },
      {
        id: "actions",
        cell: ({ row }) => (
          <div className="text-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm">
                  <span className="sr-only">{t("openMenu")}</span>
                  <MoreHorizontalIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>{tc("actions")}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    setEditing(row.original);
                    setFormOpen(true);
                  }}>
                  {tc("edit")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigator.clipboard?.writeText(row.original.email)}>
                  {t("copyEmail")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => setDeleting(row.original)}>
                  {tc("delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )
      }
    ],
    [formatTime, labels, t, tc]
  );

  const table = useReactTable({
    data: items,
    columns,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    onRowSelectionChange: setRowSelection,
    state: { rowSelection }
  });

  const selectedIds = Object.keys(rowSelection).filter((id) => rowSelection[id]);
  const selectedCount = selectedIds.length;
  const firstRow = total === 0 ? 0 : (pageIndex - 1) * pageSize + 1;
  const lastRow = Math.min(pageIndex * pageSize, total);

  const exportFilter = selectedCount > 0 ? { ...filter, contact_ids: selectedIds } : filter;
  function onExport(e: React.MouseEvent) {
    if (selectedCount > MAX_EXPORT_SELECTED) {
      e.preventDefault();
      toast.error(t("exportTooMany", { max: MAX_EXPORT_SELECTED }));
    }
  }

  const deleteContact = useDeleteContact();
  async function confirmDelete() {
    if (!deleting) return;
    try {
      await deleteContact.mutateAsync(deleting.id);
      setRowSelection((s) => {
        const next = { ...s };
        delete next[deleting.id];
        return next;
      });
      toast.success(t("deleted"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("deleteFail"));
    } finally {
      setDeleting(null);
    }
  }

  const hasFilter = query.rules.length > 0 || keyword.trim() !== "" || excludeSuspect;
  const pageButtons = Array.from({ length: pageCount }, (_, i) => i + 1).filter(
    (p) => p === 1 || p === pageCount || Math.abs(p - pageIndex) <= 1
  );

  return (
    <>
      <div className="flex flex-row items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight lg:text-2xl">{t("title")}</h1>
        <div className="flex gap-2">
          <Button variant="outline" asChild><Link href="/contacts/import">{t("batchImport")}</Link></Button>
          <Button
            onClick={() => {
              setEditing(undefined);
              setFormOpen(true);
            }}>
            <PlusIcon /> {t("new")}
          </Button>
        </div>
      </div>
      <Card>
        <CardContent className="flex flex-col p-0 [&_[data-slot=table-container]]:flex-1">
          <div className="flex min-h-14 flex-wrap items-center gap-2 border-b px-(--card-spacing) py-3">
            {selectedCount > 0 ? (
              <>
                <span className="px-1 text-sm font-medium">{t("selectedCount", { count: selectedCount })}</span>
                <Button variant="outline" size="sm" onClick={() => setTagBatchOpen(true)}>
                  <TagIcon /> {t("tagBatch")}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm">
                      <UserRoundCheckIcon /> {t("changeStatus")}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onClick={() => setStatusTarget("active")}>{t("setActive")}</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setStatusTarget("invalid")}>{t("setInvalid")}</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setStatusTarget("unsubscribed")}>{t("setUnsubscribed")}</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button variant="outline" size="sm" onClick={() => setLanguageBatchOpen(true)}>
                  <LanguagesIcon /> {t("language")}
                </Button>
                <Button variant="outline" size="sm" className="text-destructive" onClick={() => setDeleteBatchOpen(true)}>
                  <Trash2Icon /> {tc("delete")}
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <a href={contactsExportUrl(exportFilter)} download onClick={onExport}>
                    <DownloadIcon /> {t("exportSelected")}
                  </a>
                </Button>
                <Button variant="outline" size="sm" className="ms-auto" onClick={() => setRowSelection({})}>
                  {t("clearSelection")}
                </Button>
              </>
            ) : (
              <>
                <div className="relative">
                  <SearchIcon className="text-muted-foreground absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2" />
                  <Input
                    placeholder={t("searchPh")}
                    value={keywordInput}
                    onChange={(e) => setKeywordInput(e.target.value)}
                    className="h-7 w-48 ps-8 text-[0.8rem] lg:w-60"
                  />
                </div>
                <Filters
                  fields={fields}
                  query={query}
                  onQueryChange={setQuery}
                  // 筛选只表达“属于 / 包含”，不支持取反
                  onBeforeQueryChange={(_next, details) => details.reason !== "negate"}
                  labels={filterUiLabels}
                  size="sm"
                  showClear
                  trigger={
                    <Button variant="outline" size="sm">
                      <ListFilterIcon /> {t("filter")}
                    </Button>
                  }
                  className="flex-1 @max-md/card:flex-initial"
                />
                <div className="flex items-center gap-1.5">
                  <Switch
                    id="exclude-suspect"
                    size="sm"
                    checked={excludeSuspect}
                    onCheckedChange={setExcludeSuspect}
                  />
                  <Label htmlFor="exclude-suspect" className="text-xs whitespace-nowrap">
                    {t("excludeSuspect")}
                  </Label>
                </div>
              </>
            )}
            {selectedCount === 0 && (
              <div className="ms-auto flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setTagManagerOpen(true)}>
                  <TagsIcon /> <span className="hidden sm:inline">{t("manageTags")}</span>
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <a href={contactsExportUrl(filter)} download>
                    <DownloadIcon /> <span className="hidden sm:inline">{t("export")}</span>
                  </a>
                </Button>
              </div>
            )}
          </div>

          <Table className="[&_td:first-child]:ps-(--card-spacing) [&_td:last-child]:pe-(--card-spacing) [&_th:first-child]:ps-(--card-spacing) [&_th:last-child]:pe-(--card-spacing)">
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHead key={header.id}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }, (_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={columns.length}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : isError ? (
                <TableRow>
                  <TableCell colSpan={columns.length} className="text-destructive h-24 text-center">
                    {error instanceof ApiError ? error.message : t("loadFail")}
                  </TableCell>
                </TableRow>
              ) : table.getRowModel().rows.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id} data-state={row.getIsSelected() && "selected"}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={columns.length} className="p-0">
                    <Empty>
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <UsersIcon />
                        </EmptyMedia>
                        <EmptyTitle>{hasFilter ? t("emptyFiltered") : t("empty")}</EmptyTitle>
                        <EmptyDescription>
                          {hasFilter ? t("emptyFilteredDesc") : t("emptyDesc")}
                        </EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          <div
            className="flex flex-col items-center justify-between gap-3 border-t px-(--card-spacing) py-3 sm:flex-row"
            aria-busy={isFetching}>
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              {t("perPage")}
              <Select
                value={String(pageSize)}
                onValueChange={(v) => {
                  setPageSize(Number(v));
                  setPageIndex(1);
                }}>
                <SelectTrigger size="sm" className="w-fit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZES.map((size) => (
                    <SelectItem key={size} value={String(size)}>
                      {size}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {t("rows")}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-muted-foreground text-sm tabular-nums">
                {t("range", { first: firstRow, last: lastRow, total })}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon-sm"
                  onClick={() => setPageIndex((p) => Math.max(1, p - 1))}
                  disabled={pageIndex <= 1}>
                  <span className="sr-only">{tc("prevPage")}</span>
                  <ChevronLeftIcon />
                </Button>
                {pageButtons.map((p, i) => (
                  <React.Fragment key={p}>
                    {i > 0 && p - pageButtons[i - 1]! > 1 && <span className="text-muted-foreground px-1">…</span>}
                    <Button
                      variant={p === pageIndex ? "outline" : "ghost"}
                      size="icon-sm"
                      className="tabular-nums"
                      onClick={() => setPageIndex(p)}>
                      {p}
                    </Button>
                  </React.Fragment>
                ))}
                <Button
                  variant="outline"
                  size="icon-sm"
                  onClick={() => setPageIndex((p) => Math.min(pageCount, p + 1))}
                  disabled={pageIndex >= pageCount}>
                  <span className="sr-only">{tc("nextPage")}</span>
                  <ChevronRightIcon />
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <ContactFormDialog open={formOpen} onOpenChange={setFormOpen} contact={editing} />
      <TagManagerDialog open={tagManagerOpen} onOpenChange={setTagManagerOpen} />
      <TagBatchDialog
        open={tagBatchOpen}
        onOpenChange={setTagBatchOpen}
        contactIds={selectedIds}
        onDone={() => setRowSelection({})}
      />
      <StatusChangeDialog
        status={statusTarget}
        contactIds={selectedIds}
        onClose={() => setStatusTarget(null)}
        onDone={() => setRowSelection({})}
      />
      <DeleteBatchDialog
        open={deleteBatchOpen}
        contactIds={selectedIds}
        onClose={() => setDeleteBatchOpen(false)}
        onDone={() => setRowSelection({})}
      />
      <LanguageBatchDialog
        open={languageBatchOpen}
        onOpenChange={setLanguageBatchOpen}
        contactIds={selectedIds}
        onDone={() => setRowSelection({})}
      />

      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteConfirmDesc", { email: deleting?.email ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmDelete}>
              {tc("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Muted() {
  return <span className="text-muted-foreground">—</span>;
}
