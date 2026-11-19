/** 把正文里的 `{{key}}` 提升为 TipTap Badge 节点 HTML（§11.3）。 */

const EXISTING_NODE =
  /<span\b[^>]*\bdata-template-variable=(["'])(.*?)\1[^>]*>\{\{[^{}]+\}\}<\/span>/gi;
const BARE_VARIABLE = /\{\{([^{}]+)\}\}/g;

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** 已是 `data-template-variable` 的节点保持不动；其余 `{{…}}` 包成 Badge span。 */
export function promoteTemplateVariables(html: string): string {
  const kept: string[] = [];
  const masked = html.replace(EXISTING_NODE, (match) => {
    const token = `\uE000${kept.length}\uE000`;
    kept.push(match);
    return token;
  });
  const promoted = masked.replace(BARE_VARIABLE, (_match, inner: string) => {
    const key = inner.trim();
    return `<span data-template-variable="${escapeAttr(key)}" class="bg-primary/10 text-primary inline-flex rounded-md px-1.5 py-0.5 text-xs" contenteditable="false">{{${key}}}</span>`;
  });
  return promoted.replace(/\uE000(\d+)\uE000/g, (_match, index: string) => kept[Number(index)]!);
}
