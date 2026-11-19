import sanitizeHtml from "sanitize-html";

const ALLOWED_ATTRIBUTES = [
  "style", "class", "align", "valign", "width", "height", "bgcolor", "border", "cellpadding",
  "cellspacing", "colspan", "rowspan", "href", "src", "alt", "title", "target", "color", "face", "size"
];

/** 服务端与保存接口共用的邮件 HTML 白名单（§7.3）。 */
export function sanitizeEmailHtml(html: string): string {
  return sanitizeHtml(html, {
    // SPEC-GAP: 为执行“</body> 前注入像素”，额外保留完整邮件的结构标签。
    allowedTags: [...sanitizeHtml.defaults.allowedTags, "html", "head", "body", "style", "table", "thead", "tbody", "tfoot", "tr", "td", "th", "img", "center", "font", "span", "div", "h1", "h2", "h3", "h4", "h5", "h6", "hr"],
    allowedAttributes: { "*": ALLOWED_ATTRIBUTES },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { img: ["http", "https", "data"] },
    disallowedTagsMode: "discard",
    // 邮件规格明确要求保留 style；最终预览使用 sandbox iframe，发送端不执行邮件脚本。
    allowVulnerableTags: true
  });
}
