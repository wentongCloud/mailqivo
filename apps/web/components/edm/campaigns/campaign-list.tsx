"use client";

import * as React from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { Edit, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import type { CampaignListDto } from "@mailqivo/shared";
import { useCampaigns, useDeleteCampaign } from "@/lib/api/campaigns";
import { ApiError } from "@/lib/api/client";
import { useLocalizedLabels } from "@/lib/use-app-locale";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/** §11.5：draft/scheduled=secondary；preparing/sending=default；paused=warning；completed=success；cancelled/failed=destructive。 */
export function statusVariant(status: CampaignListDto["status"]): "default" | "secondary" | "destructive" | "success" | "warning" {
  if (["cancelled", "failed"].includes(status)) return "destructive";
  if (status === "completed") return "success";
  if (status === "paused") return "warning";
  if (["draft", "scheduled"].includes(status)) return "secondary";
  return "default";
}

export function CampaignList() {
  const t = useTranslations("Campaigns");
  const tc = useTranslations("Common");
  const { campaignStatus, dateLocale } = useLocalizedLabels();
  const [page, setPage] = React.useState(1);
  const { data, isLoading } = useCampaigns(page);
  const remove = useDeleteCampaign();
  const [deleting, setDeleting] = React.useState<CampaignListDto | null>(null);
  const items = data?.items ?? [];
  return <div className="space-y-4">
    <div className="flex items-center justify-between"><div><h1 className="text-2xl font-semibold">{t("title")}</h1></div><Button asChild><Link href="/campaigns/new"><Plus />{t("new")}</Link></Button></div>
    {isLoading ? <Skeleton className="h-64" /> : items.length === 0 ? <Empty><EmptyHeader><EmptyTitle>{t("empty")}</EmptyTitle></EmptyHeader><Button asChild><Link href="/campaigns/new"><Plus />{t("new")}</Link></Button></Empty> : <Card><CardContent className="overflow-x-auto p-0"><Table>
      <TableHeader><TableRow><TableHead>{t("name")}</TableHead><TableHead>{t("status")}</TableHead><TableHead className="min-w-40">{t("progress")}</TableHead><TableHead>{t("openRate")}</TableHead><TableHead>{t("createdAt")}</TableHead><TableHead className="text-right">{tc("actions")}</TableHead></TableRow></TableHeader>
      <TableBody>{items.map((item) => {
        const processed = item.metrics.sent + item.metrics.failed + item.metrics.bounced;
        const progress = item.metrics.total ? Math.min(100, processed / item.metrics.total * 100) : 0;
        const openRate = item.metrics.sent ? `${(item.metrics.opened / item.metrics.sent * 100).toFixed(1)}%` : "—";
        return <TableRow key={item.id}><TableCell><div className="max-w-64"><Link href={`/campaigns/${item.id}`} className="block truncate font-medium hover:underline">{item.name}</Link><p className="text-muted-foreground truncate text-xs">{item.subject}</p></div></TableCell><TableCell><Badge variant={statusVariant(item.status)}>{campaignStatus[item.status]}</Badge></TableCell><TableCell><div className="flex items-center gap-2"><Progress value={progress} className="w-24" /><span className="text-muted-foreground text-xs whitespace-nowrap">{processed} / {item.metrics.total}</span></div></TableCell><TableCell>{openRate}</TableCell><TableCell className="text-muted-foreground text-sm">{format(parseISO(item.created_at), "yyyy-MM-dd HH:mm", { locale: dateLocale })}</TableCell><TableCell><div className="flex justify-end gap-1">{item.status === "draft" && <><Button size="icon-sm" variant="ghost" aria-label={`${tc("edit")} ${item.name}`} asChild><Link href={`/campaigns/${item.id}/edit`}><Edit /></Link></Button><Button size="icon-sm" variant="ghost" aria-label={`${tc("delete")} ${item.name}`} onClick={() => setDeleting(item)}><Trash2 /></Button></>}</div></TableCell></TableRow>;
      })}</TableBody>
    </Table></CardContent></Card>}
    {data && data.total > data.page_size && <div className="flex items-center justify-between"><span className="text-muted-foreground text-sm">{t("totalCount", { count: data.total })}</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>{tc("prevPage")}</Button><Button variant="outline" size="sm" disabled={page * data.page_size >= data.total} onClick={() => setPage((value) => value + 1)}>{tc("nextPage")}</Button></div></div>}
    <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t("deleteConfirmTitle")}</AlertDialogTitle><AlertDialogDescription>{t("deleteConfirmDesc", { name: deleting?.name ?? "" })}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{tc("cancel")}</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={async () => { if (!deleting) return; try { await remove.mutateAsync(deleting.id); toast.success(t("deleted")); setDeleting(null); } catch (err) { toast.error(err instanceof ApiError ? err.message : tc("deleteFailed")); } }}>{tc("confirm")}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}
