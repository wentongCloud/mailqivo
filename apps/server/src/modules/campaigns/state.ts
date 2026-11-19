import type { CampaignStatus } from "@mailqivo/shared";
import { Errors } from "../../lib/errors.ts";

/** §6.1 唯一活动状态转换表；所有入口必须经此函数检查。 */
const TRANSITIONS: Record<CampaignStatus, readonly CampaignStatus[]> = {
  draft: ["preparing", "scheduled", "cancelled"],
  scheduled: ["preparing", "cancelled"],
  preparing: ["sending", "failed", "cancelled"],
  sending: ["paused", "completed", "cancelled"],
  paused: ["sending", "cancelled"],
  // V1.1：completed → sending 仅限 unknown 人工回收（§6.1、§6.3），须带 via="requeue_unknown"。
  completed: ["sending"],
  cancelled: [],
  failed: []
};

/** 只允许经指定入口发生的转换；其他调用方（如 resume、prepare）不能借用。 */
export type CampaignTransitionVia = "requeue_unknown";
const RESTRICTED: Partial<Record<`${CampaignStatus}:${CampaignStatus}`, CampaignTransitionVia>> = {
  "completed:sending": "requeue_unknown"
};

export function canCampaignTransition(from: CampaignStatus, to: CampaignStatus, via?: CampaignTransitionVia): boolean {
  if (!TRANSITIONS[from].includes(to)) return false;
  const required = RESTRICTED[`${from}:${to}`];
  return !required || required === via;
}

export function assertCampaignTransition(from: CampaignStatus, to: CampaignStatus, via?: CampaignTransitionVia): void {
  if (!canCampaignTransition(from, to, via)) {
    throw Errors.invalidState(`活动不能从 ${from} 转换为 ${to}`, { from, to });
  }
}
