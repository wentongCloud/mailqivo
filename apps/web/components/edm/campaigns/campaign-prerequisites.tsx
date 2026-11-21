"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { CircleAlert } from "lucide-react";
import { useCampaignPrerequisites } from "@/lib/api/campaigns";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CampaignEditor } from "./campaign-editor";

/**
 * 设计 §1.1、规格 §6.2 第 1 条：新建活动前检查发送通道与退订配置。
 * 缺项时列出全部缺项及设置位置，补齐后由用户重新检查；服务端创建草稿时执行同一检查。
 */
export function NewCampaign() {
  const t = useTranslations("CampaignPrerequisites");
  const { data, isLoading, isFetching, refetch } = useCampaignPrerequisites();
  if (isLoading) return <Skeleton className="h-[70vh]" />;
  if (data?.ready) return <CampaignEditor />;
  const missing = data?.missing ?? [];
  return (
    <div className="space-y-4">
      <Alert variant="destructive">
        <CircleAlert />
        <AlertTitle>{t("title")}</AlertTitle>
        <AlertDescription>
          {missing.length === 0 ? (
            <p>{t("loadFailed")}</p>
          ) : (
            <ul className="list-disc space-y-1 pl-5">
              {missing.includes("channel") && (
                <li>
                  {t("channel")}{" "}
                  <Link className="underline" href="/settings/channels">
                    {t("channelLink")}
                  </Link>
                </li>
              )}
              {missing.includes("unsubscribe") && <li>{t("unsubscribe")}</li>}
            </ul>
          )}
        </AlertDescription>
      </Alert>
      <div className="flex gap-2">
        <Button variant="outline" asChild>
          <Link href="/campaigns">{t("back")}</Link>
        </Button>
        <Button disabled={isFetching} onClick={() => void refetch()}>
          {t("recheck")}
        </Button>
      </div>
    </div>
  );
}
