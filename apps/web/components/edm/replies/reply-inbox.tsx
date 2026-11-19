"use client";

import * as React from "react";
import Link from "next/link";
import { format, parseISO, type Locale } from "date-fns";
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Inbox,
  MailWarning,
  MessageSquareReply,
  MousePointerClick
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { type Layout } from "react-resizable-panels";
import { INBOUND_CATEGORY_VALUES, type InboundCategory, type ReplyIntent } from "@mailqivo/shared";
import { useLocalizedLabels } from "@/lib/use-app-locale";
import { useReplies, useReply, useUpdateReply, type ReplyFilters } from "@/lib/api/replies";
import { ApiError } from "@/lib/api/client";
import { useIsMobile } from "@/hooks/use-mobile";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

const CATEGORY_ICON = { human: MessageSquareReply, auto_reply: Bot, bounce: MailWarning, unrelated: Inbox };
const DEFAULT_LAYOUT: Layout = { "reply-navigation": 16, "reply-list": 30, "reply-detail": 54 };

function useCategoryLabel() {
  const t = useTranslations("Replies");
  return React.useCallback(
    (category: InboundCategory) => {
      switch (category) {
        case "human":
          return t("human");
        case "auto_reply":
          return t("auto");
        case "bounce":
          return t("bounce");
        default:
          return t("noise");
      }
    },
    [t]
  );
}

function useIntentLabel() {
  const t = useTranslations("Replies");
  return React.useCallback(
    (intent: ReplyIntent) => {
      switch (intent) {
        case "interested":
          return t("intentInterest");
        case "inquiry":
          return t("intentQuestion");
        case "reject":
          return t("intentReject");
        case "complaint":
          return t("intentComplaint");
        case "unsubscribe_request":
          return t("intentUnsub");
        default:
          return t("intentOther");
      }
    },
    [t]
  );
}

function formatDateTime(value: string, dateLocale: Locale, pattern: string) {
  return format(parseISO(value), pattern, { locale: dateLocale });
}

async function copyText(text: string) {
  try {
    await Promise.race([
      navigator.clipboard.writeText(text),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("clipboard timeout")), 800))
    ]);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  }
}

function ReplyReading({ id, onChanged }: { id?: string; onChanged?: () => void }) {
  const t = useTranslations("Replies");
  const labels = useLocalizedLabels();
  const categoryLabel = useCategoryLabel();
  const intentLabel = useIntentLabel();
  const { data: reply, isLoading } = useReply(id);
  const update = useUpdateReply(id ?? "");
  const mutate = async (body: Parameters<typeof update.mutateAsync>[0], message: string) => {
    try {
      await update.mutateAsync(body);
      toast.success(message);
      onChanged?.();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("actionFail"));
    }
  };
  const copy = async () => {
    if (!reply?.suggested_reply) return;
    if (await copyText(reply.suggested_reply)) toast.success(t("copied"));
    else toast.error(t("copyFail"));
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-[52px] shrink-0 flex-wrap items-center gap-2 px-2">
        <Button
          size="sm"
          variant="ghost"
          disabled={!reply || reply.handled || update.isPending}
          onClick={() => void mutate({ handled: true }, t("markedHandled"))}
        >
          <Check />
          {reply?.handled ? t("handled") : t("markHandled")}
        </Button>
        <Separator orientation="vertical" className="h-6" />
        <Select
          disabled={!reply}
          value={reply?.category ?? "unrelated"}
          onValueChange={(category) =>
            void mutate(
              {
                category: category as InboundCategory,
                ...(category === "bounce" ? { reason_code: "UNKNOWN" } : {})
              },
              t("categoryUpdated")
            )
          }
        >
          <SelectTrigger size="sm" className="ml-auto w-32" aria-label={t("changeCategory")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {INBOUND_CATEGORY_VALUES.map((category) => (
              <SelectItem key={category} value={category}>
                {categoryLabel(category)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Separator />
      {!id ? (
        <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center text-sm">
          <MousePointerClick className="size-8 opacity-50" />
          {t("pickOne")}
        </div>
      ) : isLoading || !reply ? (
        <div className="space-y-4 p-6">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-20" />
          <Skeleton className="h-72" />
        </div>
      ) : (
        <>
          <div className="flex items-start gap-4 p-4 text-sm">
            <Avatar>
              <AvatarFallback>
                {reply.from_email?.slice(0, 2).toUpperCase() || t("fallbackAvatar")}
              </AvatarFallback>
            </Avatar>
            <div className="grid min-w-0 flex-1 gap-1">
              <div className="font-semibold break-all">{reply.from_email || t("unknownSender")}</div>
              <h2 className="line-clamp-2 text-xs">{reply.subject || t("noSubject")}</h2>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={reply.needs_review ? "destructive" : "outline"}>
                  {reply.needs_review
                    ? t("needsReview")
                    : reply.category
                      ? categoryLabel(reply.category)
                      : t("uncategorised")}
                </Badge>
                {reply.campaign_id && (
                  <Link
                    className="text-muted-foreground text-xs hover:underline"
                    href={`/campaigns/${reply.campaign_id}`}
                  >
                    {t("campaignLink", { name: reply.campaign_name || t("viewCampaign") })}
                  </Link>
                )}
              </div>
            </div>
            <time className="text-muted-foreground ml-auto shrink-0 text-xs">
              {formatDateTime(reply.received_at, labels.dateLocale, t("dateFormat"))}
            </time>
          </div>
          <Separator />
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-6 p-4">
              {(reply.summary || reply.intent) && (
                <section className="space-y-2">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium">{t("aiSummary")}</h3>
                    {reply.intent && <Badge variant="secondary">{intentLabel(reply.intent)}</Badge>}
                  </div>
                  <p className="text-sm leading-6">{reply.summary || t("noSummary")}</p>
                </section>
              )}
              {reply.reason_code && (
                <section className="space-y-2">
                  <h3 className="text-sm font-medium">{t("bounceReason")}</h3>
                  <div className="text-sm">
                    <p>
                      {labels.reasonCode(reply.reason_code).category} ·{" "}
                      {labels.reasonCode(reply.reason_code).label}
                    </p>
                    {reply.dsn_status && (
                      <p className="text-muted-foreground mt-1 font-mono text-xs">
                        {reply.dsn_status} {reply.diagnostic}
                      </p>
                    )}
                  </div>
                </section>
              )}
              {reply.suggested_reply && (
                <section className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium">{t("suggestedReply")}</h3>
                    <Button size="sm" variant="ghost" onClick={() => void copy()}>
                      <Copy />
                      {t("copy")}
                    </Button>
                  </div>
                  <p className="bg-muted/50 rounded-lg p-4 text-sm leading-6 whitespace-pre-wrap">
                    {reply.suggested_reply}
                  </p>
                </section>
              )}
              <section className="space-y-2">
                <h3 className="text-sm font-medium">{t("bodyTitle")}</h3>
                <p className="text-sm leading-6 break-words whitespace-pre-wrap">
                  {reply.body_text || t("noBody")}
                </p>
              </section>
            </div>
          </ScrollArea>
        </>
      )}
    </div>
  );
}

export function ReplyInbox({ campaignId, embedded = false }: { campaignId?: string; embedded?: boolean }) {
  const t = useTranslations("Replies");
  const tc = useTranslations("Common");
  const labels = useLocalizedLabels();
  const categoryLabel = useCategoryLabel();
  const intentLabel = useIntentLabel();
  const [category, setCategory] = React.useState<InboundCategory | "review" | "all">(
    campaignId ? "all" : "human"
  );
  const [unhandled, setUnhandled] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const [selectedId, setSelectedId] = React.useState<string>();
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const isMobile = useIsMobile();
  const filters: ReplyFilters = {
    campaignId,
    category: category === "all" || category === "review" ? undefined : category,
    needsReview: category === "review",
    unhandled
  };
  const { data, isLoading } = useReplies(filters, page);
  const activeId =
    selectedId && data?.items.some((item) => item.id === selectedId)
      ? selectedId
      : data?.items[0]?.id;
  const chooseCategory = (value: typeof category) => {
    setCategory(value);
    setPage(1);
    setSelectedId(undefined);
  };
  const nav = (
    <nav aria-label={t("navLabel")} className="space-y-1 p-2">
      <Button
        variant={category === "all" ? "secondary" : "ghost"}
        className="w-full justify-between"
        onClick={() => chooseCategory("all")}
      >
        <span className="flex items-center gap-2">
          <Inbox />
          {t("allMail")}
        </span>
        <Badge variant="secondary">
          {data?.counts.human !== undefined
            ? data.counts.human +
              data.counts.auto_reply +
              data.counts.bounce +
              data.counts.unrelated
            : 0}
        </Badge>
      </Button>
      {INBOUND_CATEGORY_VALUES.map((value) => {
        const Icon = CATEGORY_ICON[value];
        return (
          <Button
            key={value}
            variant={category === value ? "secondary" : "ghost"}
            className="w-full justify-between"
            onClick={() => chooseCategory(value)}
          >
            <span className="flex items-center gap-2">
              <Icon />
              {categoryLabel(value)}
            </span>
            <Badge variant="outline">{data?.counts[value] ?? 0}</Badge>
          </Button>
        );
      })}
      <Button
        variant={category === "review" ? "secondary" : "ghost"}
        className="w-full justify-between"
        onClick={() => chooseCategory("review")}
      >
        <span className="flex items-center gap-2">
          <AlertCircle />
          {t("needsReview")}
        </span>
        <Badge variant={data?.counts.needs_review ? "destructive" : "outline"}>
          {data?.counts.needs_review ?? 0}
        </Badge>
      </Button>
    </nav>
  );
  const list = (
    <Tabs
      value={unhandled ? "unhandled" : "all"}
      onValueChange={(value) => {
        setUnhandled(value === "unhandled");
        setPage(1);
      }}
      className="flex h-full min-h-0 flex-col gap-0"
    >
      <div className="flex h-[52px] shrink-0 items-center px-4">
        <h1 className="text-xl font-bold">{t("title")}</h1>
        <TabsList className="ml-auto">
          <TabsTrigger value="all">{t("all")}</TabsTrigger>
          <TabsTrigger value="unhandled">{t("unhandled")}</TabsTrigger>
        </TabsList>
      </div>
      <Separator />
      <div className="bg-background/59 flex items-center gap-3 p-4 backdrop-blur-md">
        <Select
          value={category}
          onValueChange={(value) => chooseCategory(value as typeof category)}
        >
          <SelectTrigger className="w-full" aria-label={t("filterCategory")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("allMail")}</SelectItem>
            {INBOUND_CATEGORY_VALUES.map((value) => (
              <SelectItem key={value} value={value}>
                {categoryLabel(value)}
              </SelectItem>
            ))}
            <SelectItem value="review">{t("needsReview")}</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-muted-foreground shrink-0 text-xs">
          {t("count", { n: data?.total ?? 0 })}
        </span>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-2 p-4 pt-0">
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
            </div>
          ) : data?.items.length ? (
            data.items.map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => {
                  setSelectedId(item.id);
                  if (isMobile) setMobileOpen(true);
                }}
                className={cn(
                  "hover:bg-accent/70 focus-visible:ring-ring flex min-h-28 w-full cursor-pointer flex-col items-start gap-2 rounded-lg border p-3 text-left text-sm transition-all focus-visible:ring-2 focus-visible:outline-none",
                  activeId === item.id && "bg-accent/70"
                )}
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <span className="truncate font-semibold">
                    {item.from_email || t("unknownSender")}
                  </span>
                  <time className="text-muted-foreground shrink-0 text-xs">
                    {formatDateTime(item.received_at, labels.dateLocale, t("dateFormat"))}
                  </time>
                </div>
                <p className="w-full truncate text-xs font-medium">
                  {item.subject || t("noSubject")}
                </p>
                <p className="text-muted-foreground line-clamp-2 text-left text-xs">
                  {item.summary || item.preview || t("noPreview")}
                </p>
                <div className="flex gap-1.5">
                  {item.intent && <Badge variant="secondary">{intentLabel(item.intent)}</Badge>}
                  {item.needs_review && <Badge variant="destructive">{t("pending")}</Badge>}
                  {item.handled && <Badge variant="outline">{t("handled")}</Badge>}
                </div>
              </button>
            ))
          ) : (
            <div className="text-muted-foreground flex min-h-64 flex-col items-center justify-center gap-2 p-6 text-center text-sm">
              <Inbox className="size-8" />
              <p>{t("empty")}</p>
            </div>
          )}
        </div>
      </ScrollArea>
      {data && data.total > data.page_size && (
        <div className="flex items-center justify-between border-t p-2">
          <Button size="sm" variant="ghost" disabled={page === 1} onClick={() => setPage((v) => v - 1)}>
            <ChevronLeft />
            {tc("prevPage")}
          </Button>
          <span className="text-muted-foreground text-xs">{t("page", { n: page })}</span>
          <Button
            size="sm"
            variant="ghost"
            disabled={page * data.page_size >= data.total}
            onClick={() => setPage((v) => v + 1)}
          >
            {tc("nextPage")}
            <ChevronRight />
          </Button>
        </div>
      )}
    </Tabs>
  );
  return (
    <section
      className={cn(
        "overflow-hidden rounded-md border bg-background",
        embedded ? "h-[720px]" : "h-[calc(100dvh-8.5rem)] min-h-[560px]"
      )}
    >
      <ResizablePanelGroup
        orientation="horizontal"
        defaultLayout={DEFAULT_LAYOUT}
        id={`reply-inbox:${campaignId ?? "all"}`}
        className="items-stretch"
      >
        <ResizablePanel
          id="reply-navigation"
          hidden={isMobile}
          collapsible
          minSize="15%"
          maxSize="20%"
          collapsedSize="4%"
          className="min-w-[150px]"
        >
          <div className="flex h-[52px] items-center border-b px-4 font-semibold">{t("navTitle")}</div>
          {nav}
        </ResizablePanel>
        <ResizableHandle hidden={isMobile} withHandle />
        <ResizablePanel id="reply-list" minSize="30%" className="min-w-0">
          {list}
        </ResizablePanel>
        <ResizableHandle hidden={isMobile} withHandle />
        <ResizablePanel id="reply-detail" hidden={isMobile} minSize="30%" className="min-w-0">
          <ReplyReading id={activeId} />
        </ResizablePanel>
      </ResizablePanelGroup>
      <Drawer open={mobileOpen} onOpenChange={setMobileOpen}>
        <DrawerContent className="h-[88dvh] max-h-none">
          <DrawerHeader className="sr-only">
            <DrawerTitle>{t("detailTitle")}</DrawerTitle>
            <DrawerDescription>{t("detailDesc")}</DrawerDescription>
          </DrawerHeader>
          <div className="flex items-center border-b px-2">
            <Button variant="ghost" size="sm" onClick={() => setMobileOpen(false)}>
              <ArrowLeft />
              {t("backToList")}
            </Button>
          </div>
          <ReplyReading id={activeId} />
        </DrawerContent>
      </Drawer>
    </section>
  );
}
