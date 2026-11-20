"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useLocalizedLabels } from "@/hooks/use-app-locale";
import { useCampaigns, useCampaignStats } from "@/lib/api/campaigns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { CampaignStatCards } from "./campaign-detail";

export function StatsOverview() {
  const t = useTranslations("Stats");
  const tc = useTranslations("Campaigns");
  const locale = useLocale();
  const labels = useLocalizedLabels();
  const campaigns = useCampaigns();
  const [selected, setSelected] = React.useState<string>();
  const id = selected ?? campaigns.data?.items[0]?.id;
  const stats = useCampaignStats(id);
  if (campaigns.isLoading) return <Skeleton className="h-80" />;
  if (!campaigns.data?.items.length) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyTitle>{t("empty")}</EmptyTitle>
          <EmptyDescription>{t("emptyDesc")}</EmptyDescription>
        </EmptyHeader>
        <Button asChild>
          <Link href="/campaigns/new">{tc("new")}</Link>
        </Button>
      </Empty>
    );
  }
  const current = campaigns.data.items.find((item) => item.id === id);
  const funnel = stats.data
    ? [
        { label: t("send"), value: stats.data.total },
        { label: t("delivered"), value: stats.data.delivered },
        { label: t("opened"), value: stats.data.opened },
        { label: t("replied"), value: stats.data.replied }
      ]
    : [];
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{t("desc")}</p>
        </div>
        <div className="flex gap-2">
          <Select value={id} onValueChange={setSelected}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {campaigns.data.items.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {id && (
            <Button variant="outline" size="icon" asChild>
              <Link href={`/campaigns/${id}`} aria-label={t("viewDetail")}>
                <ArrowRight />
              </Link>
            </Button>
          )}
        </div>
      </div>
      {stats.isLoading || !stats.data ? (
        <Skeleton className="h-80" />
      ) : (
        <>
          <CampaignStatCards stats={stats.data} />
          <Card>
            <CardHeader>
              <CardTitle>
                {current?.name ?? tc("title")} · {t("funnel")}
              </CardTitle>
              <CardDescription>
                {t("funnelHint")}
                {labels.common("openRateDisclaimer")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-4">
                {funnel.map((item, index) => (
                  <div key={item.label} className="relative rounded-lg border p-5 text-center">
                    <p className="text-muted-foreground text-sm">{item.label}</p>
                    <p className="mt-2 text-3xl font-semibold">
                      {item.value.toLocaleString(locale)}
                    </p>
                    {index > 0 && (
                      <p className="text-muted-foreground mt-1 text-xs">
                        {t("conversion", {
                          rate: funnel[index - 1]!.value
                            ? ((item.value / funnel[index - 1]!.value) * 100).toFixed(1)
                            : "0.0"
                        })}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
