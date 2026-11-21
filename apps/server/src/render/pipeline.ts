import juice from "juice";
import { convert } from "html-to-text";
import { escapeHtml, renderTemplate, type RenderContext } from "./template.ts";
import { sanitizeEmailHtml } from "./sanitize.ts";

export type CampaignLink = { idx: number; url: string };

export type RenderPipelineInput = {
  html: string;
  signature_html?: string | null;
  footer_html: string;
  subject: string;
  context: RenderContext;
  track_opens: boolean;
  track_clicks: boolean;
};

export type RenderPipelineResult = {
  subject: string;
  html: string;
  text: string;
  links: CampaignLink[];
  warnings: string[];
};

function rewriteLinks(html: string, baseUrl: string, trackingId: string, unsubscribeUrl: string) {
  const links: CampaignLink[] = [];
  const output = html.replace(/(<a\b[^>]*\bhref\s*=\s*)(["'])(.*?)\2/gi, (match, prefix: string, quote: string, href: string) => {
    if (!/^https?:\/\//i.test(href)) return match;
    const unsubscribePrefix = `${baseUrl}/u/`;
    if (href === escapeHtml(unsubscribeUrl) || href.startsWith(unsubscribePrefix)) return match;
    const idx = links.length;
    const original = href.replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
    links.push({ idx, url: original });
    return `${prefix}${quote}${baseUrl}/t/c/${trackingId}/${idx}${quote}`;
  });
  return { output, links };
}

/** 把片段插到第一个 `</body>` 之前；没有 `</body>` 时追加到末尾。 */
function insertBeforeBodyEnd(html: string, fragment: string): string {
  const bodyEnd = /<\/body\s*>/i;
  return bodyEnd.test(html) ? html.replace(bodyEnd, `${fragment}</body>`) : `${html}${fragment}`;
}

/** 固定顺序：组装 → 消毒 → 替换 → 链接 → 像素 → CSS 内联 → 纯文本（§7.3）。 */
export function renderPipeline(input: RenderPipelineInput): RenderPipelineResult {
  const warnings: string[] = [];
  const baseUrl = input.context.public_base_url?.replace(/\/+$/, "");
  const context = { ...input.context, public_base_url: baseUrl };
  const assembled = `${input.html}${input.signature_html ?? ""}${input.footer_html}`;
  const sanitized = sanitizeEmailHtml(assembled);
  let substituted = renderTemplate(sanitized, context, {
    html: true,
    onDefault: (key) => warnings.push(`变量 ${key} 使用了默认值`)
  });
  const escapedUrl = escapeHtml(context.unsubscribe_url);
  const hasUnsubscribeLink = Array.from(substituted.matchAll(/<a\b[^>]*?\shref\s*=\s*(["'])(.*?)\1/gi))
    .some((match) => match[2] === escapedUrl);
  if (!hasUnsubscribeLink) {
    substituted = insertBeforeBodyEnd(substituted, `<p><a href="${escapedUrl}">Unsubscribe</a></p>`);
  }
  const linked = baseUrl && input.track_clicks
    ? rewriteLinks(substituted, baseUrl, input.context.tracking_id, context.unsubscribe_url)
    : { output: substituted, links: [] };
  let withPixel = linked.output;
  if (baseUrl && input.track_opens) {
    withPixel = insertBeforeBodyEnd(withPixel, `<img src="${baseUrl}/t/o/${input.context.tracking_id}.gif" width="1" height="1" alt="" style="display:none">`);
  }
  const html = juice(withPixel);
  if (Buffer.byteLength(html, "utf8") > 500 * 1024) warnings.push("HTML 超过 500KB，正式发送会失败");
  return {
    subject: renderTemplate(input.subject, context, { html: false }),
    html,
    text: convert(html, { wordwrap: false }),
    links: linked.links,
    warnings
  };
}
