import { eq } from "drizzle-orm";
import type { CampaignTestSendBody, CampaignTestSendResult } from "@mailqivo/shared";
import type { Db } from "../../db/client.ts";
import { messages } from "../../db/schema.ts";
import { AppError } from "../../lib/errors.ts";
import { assertUnsubscribeConfigured } from "../../mail/unsubscribe.ts";
import type { MailAttachment } from "../../mail/channel.ts";
import { AssetUnavailableError, readAssetVerified } from "../assets/index.ts";
import { aiBlockKey, templateVariables, type RenderContact } from "../../render/template.ts";
import { getChannelMailer } from "../channels/service.ts";
import { getContact } from "../contacts/service.ts";
import { getSettings } from "../settings/service.ts";
import { resolveCampaignChannel } from "./channel.ts";
import { contactForRender, placeholderAiContent, renderCampaign } from "./render.ts";
import { getCampaignRow, type CampaignRuntimeConfig } from "./service.ts";
import { assertRuleAttachments, contactIndustry, matchContentRule, parseStoredRules } from "./content-rules.ts";

/**
 * §7.3 V1.1：按所用联系人（占位联系人无标签）临时匹配规则，附件与 send 第一步同一校验；失败 → VALIDATION。
 * 返回按规则顺序、去重后的附件内容。
 */
async function testSendAttachments(db: Db, runtime: CampaignRuntimeConfig, rulesValue: unknown, contactTags: string[], industry = ""): Promise<MailAttachment[]> {
  const rules = parseStoredRules(rulesValue);
  const match = matchContentRule(rules, contactTags, industry);
  if (!match || !match.rule.attachment_ids.length) return [];
  const assets = (await assertRuleAttachments(db, runtime, rules, (rule) => rule.id === match.rule.id)).get(match.rule.id) ?? [];
  const attachments: MailAttachment[] = [];
  for (const asset of assets) {
    try {
      attachments.push({ filename: asset.filename, contentType: asset.mime_type, content: await readAssetVerified(db, runtime, { asset_id: asset.id, sha256: asset.sha256, size_bytes: asset.size_bytes }) });
    } catch (error) {
      if (!(error instanceof AssetUnavailableError)) throw error;
      throw new AppError("VALIDATION", "内容规则的附件不可用", { assets: [{ asset_id: error.asset_id, problem: error.reason }] });
    }
  }
  return attachments;
}

function placeholderContact(source: string, email: string): RenderContact {
  const custom_fields: Record<string, string> = {};
  for (const { key } of templateVariables(source)) {
    if (!key.startsWith("sys.") && aiBlockKey(key) === undefined) custom_fields[key] = `[${key}]`;
  }
  return { email, name: "示例联系人", company: "示例公司", title: "示例职位", custom_fields };
}

/** 同步试发；is_test=true 且 contact_id 始终为 NULL，不写通道每日用量。 */
export async function testSendCampaign(db: Db, id: string, body: CampaignTestSendBody, runtime: CampaignRuntimeConfig): Promise<CampaignTestSendResult> {
  assertUnsubscribeConfigured(runtime);
  const campaign = await getCampaignRow(db, id);
  const channel = await resolveCampaignChannel(db, campaign);
  const mailer = await getChannelMailer(db, channel.id, runtime);
  const selected = body.contact_id ? await getContact(db, body.contact_id) : null;
  const settings = await getSettings(db);
  const source = `${campaign.subject}${campaign.html}${settings.footer_html}`;
  const attachments = await testSendAttachments(db, runtime, campaign.content_rules, selected?.tags ?? [], selected ? contactIndustry(selected.custom_fields) : "");
  const aiContent = placeholderAiContent(campaign.ai_blocks);
  const items: CampaignTestSendResult["items"] = [];

  for (const email of body.emails) {
    const contact = selected ? { ...contactForRender(selected), email } : placeholderContact(source, email);
    const [message] = await db.insert(messages).values({
      campaign_id: id,
      contact_id: null,
      email,
      is_test: true,
      status: "sending",
      rendered_vars: { contact, _contact_id: selected?.id ?? null }
    }).returning();
    try {
      const rendered = await renderCampaign(db, campaign, {
        contact,
        trackingId: message!.tracking_id,
        aiContent
      }, runtime);
      await db.update(messages).set({ click_targets: rendered.links.map(link => link.url) })
        .where(eq(messages.id, message!.id));
      const receipt = await mailer.send({
        to: email,
        subject: `[测试] ${rendered.subject}`,
        html: rendered.html,
        text: rendered.text,
        unsubscribeUrl: rendered.unsubscribeUrl,
        tracking_id: message!.tracking_id,
        campaign_id: id,
        ...(attachments.length ? { attachments } : {})
      });
      await db.update(messages).set({
        status: receipt.ok ? "sent" : "failed",
        smtp_code: receipt.code,
        smtp_response: receipt.response,
        rendered_subject: `[测试] ${rendered.subject}`,
        sent_at: receipt.ok ? new Date() : null
      }).where(eq(messages.id, message!.id));
      items.push({ id: message!.id, email, ok: receipt.ok, code: receipt.code, response: receipt.response });
    } catch (error) {
      const response = error instanceof Error ? error.message : String(error);
      await db.update(messages).set({ status: "failed", smtp_response: response }).where(eq(messages.id, message!.id));
      items.push({ id: message!.id, email, ok: false, response });
    }
  }
  return { items };
}
