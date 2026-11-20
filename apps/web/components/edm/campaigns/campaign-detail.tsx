"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DeleteCampaignButton } from "./delete-campaign-button";
import { Area, AreaChart, CartesianGrid, Label, Pie, PieChart, XAxis, YAxis } from "recharts";
import { format, parseISO, type Locale } from "date-fns";
import { ArrowLeft, CircleStop, Edit, Info, Pause, Play, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { type CampaignStats, type MessageStatus, type RequeueUnknownSummary, type ReasonCode } from "@mailqivo/shared";
import { useLocalizedLabels } from "@/hooks/use-app-locale";
import { useCampaign, useCampaignAction, useCampaignMessages, useCampaignOpens, useCampaignStats, useRequeueUnknown, type CampaignCancelResponse } from "@/lib/api/campaigns";
import { ApiError } from "@/lib/api/client";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import CountAnimation from "@/components/ui/custom/count-animation";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { statusVariant } from "./campaign-list";
import { ReplyInbox } from "@/components/edm/replies/reply-inbox";

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
function formatDateTime(value: string | null, dateLocale: Locale) {
  return value ? format(parseISO(value), "MM-dd HH:mm", { locale: dateLocale }) : "—";
}
export function CampaignStatCards({ stats }: { stats: CampaignStats }) {
  const t = useTranslations("CampaignDetail");
  const labels = useLocalizedLabels();
  const cards: { title: string; value: number; description: string; note?: string; tooltip?: string }[] = [
    { title: t("totalSent"), value: stats.total, description: t("skippedCount", { count: stats.skipped }) },
    { title: t("delivered"), value: stats.delivered, description: t("deliveryRate", { rate: percent(stats.delivery_rate) }) },
    { title: t("opened"), value: stats.opened, description: t("openRate", { rate: percent(stats.open_rate) }), note: labels.common("openRateDisclaimer"), tooltip: t("machineExcluded") },
    { title: t("replied"), value: stats.replied, description: t("replyRate", { rate: percent(stats.reply_rate) }) }
  ];
  return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map((card) => <Card key={card.title}>
    <CardHeader><CardTitle className="flex items-center gap-1.5 text-sm font-medium">{card.title}{card.tooltip && <Tooltip><TooltipTrigger asChild><Info className="text-muted-foreground size-3.5" /></TooltipTrigger><TooltipContent>{card.tooltip}</TooltipContent></Tooltip>}</CardTitle></CardHeader>
    <CardContent><div className="text-3xl font-semibold"><CountAnimation number={card.value} /></div><p className="text-muted-foreground mt-1 text-sm">{card.description}</p>{card.note && <p className="text-muted-foreground mt-1 text-xs">{card.note}</p>}</CardContent>
  </Card>)}</div>;
}

function FailureCharts({ stats }: { stats: CampaignStats }) {
  const labels = useLocalizedLabels();
  const data = stats.failure_breakdown.map((item, index) => ({ ...item, label: labels.reasonCode(item.reason as ReasonCode).label, fill: `var(--chart-${index % 5 + 1})` }));
  const config = Object.fromEntries(data.map((item) => [item.reason, { label: item.label, color: item.fill }])) as ChartConfig;
  const total = data.reduce((sum, item) => sum + item.count, 0);
  return <div className="grid gap-4 xl:grid-cols-2"><Card>
    <CardHeader><CardTitle>失败原因</CardTitle><CardDescription>SMTP 失败与退信合并统计</CardDescription></CardHeader>
    <CardContent>{data.length ? <div className="space-y-4">{data.map((item) => <div key={item.reason} className="space-y-1.5"><div className="flex justify-between gap-4 text-sm"><span>{item.label}</span><span className="font-medium">{item.count}</span></div><Progress value={total ? item.count / total * 100 : 0} /></div>)}</div> : <p className="text-muted-foreground py-12 text-center text-sm">暂无失败或退信</p>}</CardContent>
  </Card><Card>
    <CardHeader><CardTitle>失败原因分布</CardTitle><CardDescription>共 {total} 封失败或退信</CardDescription></CardHeader>
    <CardContent>{data.length ? <ChartContainer config={config} className="mx-auto aspect-square max-h-64"><PieChart><ChartTooltip content={<ChartTooltipContent hideLabel nameKey="reason" />} /><Pie data={data} dataKey="count" nameKey="reason" innerRadius={60} strokeWidth={5}><Label content={({ viewBox }) => viewBox && "cx" in viewBox && "cy" in viewBox ? <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle"><tspan x={viewBox.cx} y={viewBox.cy} className="fill-foreground text-3xl font-semibold">{total}</tspan><tspan x={viewBox.cx} y={(viewBox.cy ?? 0) + 24} className="fill-muted-foreground">失败及退信</tspan></text> : null} /></Pie></PieChart></ChartContainer> : <p className="text-muted-foreground py-12 text-center text-sm">暂无数据</p>}</CardContent>
  </Card></div>;
}

function OpensChart({ id }: { id: string }) {
  const labels = useLocalizedLabels();
  const { data = [], isLoading } = useCampaignOpens(id);
  const chartData = data.map((item) => ({ ...item, label: format(parseISO(item.hour), "MM-dd HH:mm", { locale: labels.dateLocale }) }));
  return <Card><CardHeader><CardTitle>按小时打开</CardTitle><CardDescription>默认排除疑似机器打开</CardDescription></CardHeader><CardContent>
    {isLoading ? <Skeleton className="h-64" /> : chartData.length ? <ChartContainer config={{ opens: { label: "打开次数", color: "var(--chart-1)" } }} className="h-64 w-full"><AreaChart data={chartData} margin={{ left: 0, right: 12, top: 8 }}><CartesianGrid vertical={false} /><XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} /><YAxis allowDecimals={false} width={32} tickLine={false} axisLine={false} /><ChartTooltip content={<ChartTooltipContent />} /><Area dataKey="opens" type="monotone" fill="var(--color-opens)" fillOpacity={0.2} stroke="var(--color-opens)" strokeWidth={2} /></AreaChart></ChartContainer> : <p className="text-muted-foreground py-24 text-center text-sm">暂无打开记录</p>}
  </CardContent></Card>;
}

function MessageTable({ id }: { id: string }) {
  const t = useTranslations("CampaignDetail");
  const labels = useLocalizedLabels();
  const messageLabel: Record<MessageStatus, string> = {
    pending_ai: t("msgPendingAi"),
    queued: t("msgQueued"),
    sending: t("msgSending"),
    sent: t("msgSent"),
    failed: t("msgFailed"),
    skipped: t("msgSkipped"),
    unknown: t("msgUnknown")
  };
  const [page, setPage] = React.useState(1);
  const [status, setStatus] = React.useState("all");
  const { data, isLoading } = useCampaignMessages(id, page, status === "all" ? undefined : status as MessageStatus);
  return <div className="space-y-4"><div className="flex justify-end"><Select value={status} onValueChange={(value) => { setStatus(value); setPage(1); }}><SelectTrigger className="w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{t("allStatuses")}</SelectItem>{Object.entries(messageLabel).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
    {isLoading ? <Skeleton className="h-64" /> : data?.items.length ? <><div className="overflow-x-auto rounded-lg border"><Table><TableHeader><TableRow><TableHead>{t("recipients")}</TableHead><TableHead>{t("msgSent")}</TableHead><TableHead>{t("subject")}</TableHead><TableHead>{t("failSkipReason")}</TableHead><TableHead>{t("sentAt")}</TableHead><TableHead>{t("openedAt")}</TableHead></TableRow></TableHeader><TableBody>{data.items.map((message) => <TableRow key={message.id}><TableCell>{message.email}</TableCell><TableCell><Badge variant={message.status === "failed" ? "destructive" : message.status === "sent" ? "secondary" : "outline"}>{messageLabel[message.status]}</Badge></TableCell><TableCell className="max-w-48 truncate">{message.rendered_subject ?? "—"}</TableCell><TableCell className="text-muted-foreground">{message.status === "skipped" && message.skip_reason ? labels.skipReason(message.skip_reason) : message.failure_reason ?? (message.skip_reason ? labels.skipReason(message.skip_reason) : "—")}</TableCell><TableCell>{formatDateTime(message.sent_at, labels.dateLocale)}</TableCell><TableCell>{message.open_count || "—"}</TableCell></TableRow>)}</TableBody></Table></div><div className="flex items-center justify-between"><span className="text-muted-foreground text-sm">共 {data.total} 封</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>上一页</Button><Button variant="outline" size="sm" disabled={page * data.page_size >= data.total} onClick={() => setPage((value) => value + 1)}>下一页</Button></div></div></> : <Empty><EmptyHeader><EmptyTitle>暂无收件人记录</EmptyTitle><EmptyDescription>当前筛选条件下没有邮件。</EmptyDescription></EmptyHeader></Empty>}
  </div>;
}

/** §6.3 unknown 人工回收：第一步生成摘要，第二步确认执行；摘要变化时展示新摘要再次确认。 */
function RequeueUnknownDialog({ id, open, onOpenChange }: { id: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  return <AlertDialog open={open} onOpenChange={onOpenChange}><AlertDialogContent>{open && <RequeueUnknownBody id={id} onDone={() => onOpenChange(false)} />}</AlertDialogContent></AlertDialog>;
}

function RequeueUnknownBody({ id, onDone }: { id: string; onDone: () => void }) {
  const requeue = useRequeueUnknown(id);
  const [challenge, setChallenge] = React.useState<{ token: string; summary: RequeueUnknownSummary }>();
  const [notice, setNotice] = React.useState("");
  const handle = async () => {
    try {
      const result = await requeue.mutateAsync(challenge ? { confirm_token: challenge.token } : {});
      if ("requires_confirmation" in result) { setChallenge({ token: result.confirm_token, summary: result.summary }); return; }
      toast.success(result.requeued ? `已重新排队 ${result.requeued} 封邮件` : "没有需要回收的邮件");
      onDone();
    } catch (error) {
      if (error instanceof ApiError && error.body.code === "CONFIRM_INVALID") {
        const details = error.body.details as { summary?: RequeueUnknownSummary; confirm_token?: string } | undefined;
        if (details?.summary && details.confirm_token) {
          setChallenge({ token: details.confirm_token, summary: details.summary });
          setNotice("状态未知的邮件在确认前发生变化，请核对最新数量后再次确认。");
          return;
        }
      }
      toast.error(error instanceof ApiError ? error.message : "操作失败");
    }
  };
  return <><AlertDialogHeader><AlertDialogTitle>重新发送状态未知的邮件？</AlertDialogTitle><AlertDialogDescription>{challenge ? `将把 ${challenge.summary.unknown_count} 封状态未知的邮件重新排队发送。这些邮件可能已经送达，重新发送可能导致收件人收到重复邮件。` : "状态未知的邮件在发送过程中中断，系统不会自动重发。将先生成回收摘要，确认后才会执行。"}</AlertDialogDescription></AlertDialogHeader>{notice && <p className="text-sm text-amber-600 dark:text-amber-400">{notice}</p>}<AlertDialogFooter><AlertDialogCancel>返回</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={requeue.isPending} onClick={(event) => { event.preventDefault(); void handle(); }}>{challenge ? "确认重新发送" : "生成回收摘要"}</AlertDialogAction></AlertDialogFooter></>;
}

export function CampaignDetail({ id }: { id: string }) {
  const router = useRouter();
  const t = useTranslations("CampaignDetail");
  const labels = useLocalizedLabels();
  const campaign = useCampaign(id);
  const stats = useCampaignStats(id, campaign.data?.status === "sending" || campaign.data?.status === "preparing");
  const pause = useCampaignAction(id, "pause");
  const resume = useCampaignAction(id, "resume");
  const cancel = useCampaignAction(id, "cancel");
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [requeueOpen, setRequeueOpen] = React.useState(false);
  const [cancelToken, setCancelToken] = React.useState<string>();
  const [cancelSummary, setCancelSummary] = React.useState<number>();
  const mutable = campaign.data && !["completed", "cancelled", "failed"].includes(campaign.data.status);
  const handleCancel = async () => {
    try {
      const result: CampaignCancelResponse = await cancel.mutateAsync({ confirm_token: cancelToken });
      if ("requires_confirmation" in result) {
        setCancelToken(result.confirm_token);
        setCancelSummary(result.summary.queued_messages);
        return;
      }
      toast.success("活动已取消");
      setCancelOpen(false);
      setCancelToken(undefined);
    } catch (error) { toast.error(error instanceof ApiError ? error.message : "操作失败"); }
  };
  if (campaign.isLoading || stats.isLoading) return <div className="space-y-4"><Skeleton className="h-16" /><Skeleton className="h-32" /><Skeleton className="h-80" /></div>;
  if (!campaign.data || !stats.data) return <Empty><EmptyHeader><EmptyTitle>无法加载活动</EmptyTitle><EmptyDescription>活动不存在或统计数据暂时不可用。</EmptyDescription></EmptyHeader><Button asChild><Link href="/campaigns">{t("backToList")}</Link></Button></Empty>;
  return <div className="space-y-6">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div className="space-y-2"><Button variant="ghost" size="sm" className="-ml-3" asChild><Link href="/campaigns"><ArrowLeft />{t("backToList")}</Link></Button><div className="flex flex-wrap items-center gap-3"><h1 className="text-2xl font-semibold">{campaign.data.name}</h1><Badge variant={statusVariant(campaign.data.status)}>{labels.campaignStatus[campaign.data.status]}</Badge></div><p className="text-muted-foreground text-sm">{campaign.data.subject}</p></div><div className="flex flex-wrap gap-2">
      {campaign.data.status === "draft" && <Button variant="outline" asChild><Link href={`/campaigns/${id}/edit`}><Edit />编辑草稿</Link></Button>}
      {campaign.data.status === "sending" && <Button variant="outline" onClick={async () => { try { await pause.mutateAsync({}); toast.success("活动已暂停"); } catch (error) { toast.error(error instanceof ApiError ? error.message : "暂停失败"); } }}><Pause />暂停</Button>}
      {campaign.data.status === "paused" && <Button variant="outline" onClick={async () => { try { await resume.mutateAsync({}); toast.success("活动已恢复"); } catch (error) { toast.error(error instanceof ApiError ? error.message : "恢复失败"); } }}><Play />恢复</Button>}
      {stats.data.unknown > 0 && ["sending", "paused", "completed"].includes(campaign.data.status) && <Button variant="outline" onClick={() => setRequeueOpen(true)}><RotateCcw />重新发送状态未知（{stats.data.unknown}）</Button>}
      <DeleteCampaignButton campaign={campaign.data} onDeleted={() => router.replace("/campaigns")} />
      {mutable && <Button variant="destructive" onClick={() => { setCancelToken(undefined); setCancelSummary(undefined); setCancelOpen(true); }}><CircleStop />取消活动</Button>}
    </div></div>
    <CampaignStatCards stats={stats.data} />
    <OpensChart id={id} />
    <FailureCharts stats={stats.data} />
    <Card><CardHeader><CardTitle>活动明细</CardTitle></CardHeader><CardContent><Tabs defaultValue="messages"><TabsList><TabsTrigger value="messages">收件人明细</TabsTrigger><TabsTrigger value="replies">回函</TabsTrigger></TabsList><TabsContent value="messages" className="pt-4"><MessageTable id={id} /></TabsContent><TabsContent value="replies" className="pt-4"><ReplyInbox campaignId={id} embedded /></TabsContent></Tabs></CardContent></Card>
    <RequeueUnknownDialog id={id} open={requeueOpen} onOpenChange={setRequeueOpen} />
    <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>确认取消活动？</AlertDialogTitle><AlertDialogDescription>{cancelSummary === undefined ? "将先生成取消摘要，确认后才会执行。" : `仍有 ${cancelSummary} 封邮件排队，取消后将全部跳过。`}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>返回</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={cancel.isPending} onClick={(event) => { event.preventDefault(); void handleCancel(); }}>{cancelSummary === undefined ? "生成取消摘要" : "确认取消"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}
