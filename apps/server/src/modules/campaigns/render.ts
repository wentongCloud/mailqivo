import { eq } from "drizzle-orm";
import type { ContactDto } from "@mailqivo/shared";
import type { Db } from "../../db/client.ts";
import { campaigns, signatures } from "../../db/schema.ts";
import { Errors } from "../../lib/errors.ts";
import { renderPipeline, type RenderPipelineResult } from "../../render/pipeline.ts";
import type { RenderContact } from "../../render/template.ts";
import { unsubscribeUrl } from "../../mail/unsubscribe.ts";
import { getSettings } from "../settings/service.ts";
import type { ChannelRuntimeConfig } from "../channels/service.ts";

export type CampaignRow = typeof campaigns.$inferSelect;

export async function resolveSignature(db: Db, row: CampaignRow) {
  if (row.signature_id) {
    const [signature] = await db.select().from(signatures).where(eq(signatures.id, row.signature_id));
    if (!signature) throw Errors.validation("所选签名不存在");
    return signature;
  }
  const [signature] = await db.select().from(signatures).where(eq(signatures.is_default, true));
  return signature;
}

export type RenderAssets = {
  settings: Awaited<ReturnType<typeof getSettings>>;
  signature: Awaited<ReturnType<typeof resolveSignature>>;
};

export async function loadRenderAssets(db: Db, row: CampaignRow): Promise<RenderAssets> {
  const [settings, signature] = await Promise.all([getSettings(db), resolveSignature(db, row)]);
  return { settings, signature };
}

export async function renderCampaign(
  db: Db,
  row: CampaignRow,
  input: {
    contact: RenderContact;
    trackingId: string;
    preview?: boolean;
    aiContent?: Record<string, string>;
  },
  runtime: ChannelRuntimeConfig,
  /** 调用方已加载（如发送 worker 的短期缓存）则不再查库。 */
  preloaded?: RenderAssets
): Promise<RenderPipelineResult & { unsubscribeUrl: string }> {
  const { settings, signature } = preloaded ?? await loadRenderAssets(db, row);
  const url = input.preview ? "#unsubscribe-preview" : unsubscribeUrl(runtime, input.trackingId);
  const rendered = renderPipeline({
    html: row.html,
    signature_html: signature?.html,
    footer_html: settings.footer_html,
    subject: row.subject,
    context: {
      contact: input.contact,
      settings,
      ai_content: input.aiContent,
      tracking_id: input.trackingId,
      unsubscribe_url: url,
      public_base_url: runtime.MAIL_PUBLIC_BASE_URL
    },
    track_opens: row.track_opens,
    track_clicks: row.track_clicks
  });
  return { ...rendered, unsubscribeUrl: url };
}

/** 联系人行或 ContactDto → 渲染所需字段（custom_fields 按 `{ key: string }` 存储）。 */
export function contactForRender(contact: Pick<ContactDto, "email" | "name" | "company" | "title"> & { custom_fields: unknown }): RenderContact {
  return {
    email: contact.email,
    name: contact.name,
    company: contact.company,
    title: contact.title,
    custom_fields: contact.custom_fields as Record<string, string>
  };
}

/** 占位渲染（预览、preparing 链接快照）使用的 tracking_id（§8.3「追踪 URL 用占位值」）。 */
export const PLACEHOLDER_TRACKING_ID = "00000000-0000-4000-8000-000000000000";

/** 占位渲染时每个 AI 区块的替代文本 `[AI:key]`。 */
export function placeholderAiContent(aiBlocks: unknown): Record<string, string> {
  return Object.fromEntries((aiBlocks as { key: string }[]).map((block) => [block.key, `[AI:${block.key}]`]));
}

