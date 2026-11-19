import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import { publicPageText } from "@mailqivo/shared";
import { messages } from "../../db/schema.ts";
import { localeFromRequest } from "../../lib/locale.ts";
import { applyUnsubscribe } from "../contacts/service.ts";
import { getSettings } from "../settings/service.ts";

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

const page = (lang: string, title: string, body: string) =>
  `<!doctype html><html lang="${escapeHtml(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head><body style="font-family:system-ui,sans-serif;max-width:560px;margin:80px auto;padding:24px;line-height:1.6">${body}</body></html>`;

function oneClick(body: unknown) {
  if (typeof body === "string") return new URLSearchParams(body).get("List-Unsubscribe") === "One-Click";
  return !!body && typeof body === "object" && (body as Record<string, unknown>)["List-Unsubscribe"] === "One-Click";
}

export const publicRoutes: FastifyPluginAsync = async (app) => {
  app.get("/:tracking_id", { config: { public: true } }, async (request, reply) => {
    const locale = localeFromRequest(request);
    const { tracking_id } = request.params as { tracking_id: string };
    const [message] = await app.db.select().from(messages).where(eq(messages.tracking_id, tracking_id));
    if (!message) {
      return reply
        .code(404)
        .type("text/html; charset=utf-8")
        .send(
          page(
            locale,
            publicPageText("invalidLinkTitle", locale),
            `<h1>${escapeHtml(publicPageText("invalidLinkTitle", locale))}</h1><p>${escapeHtml(publicPageText("invalidLinkBody", locale))}</p>`
          )
        );
    }
    if (message.is_test) {
      return reply
        .type("text/html; charset=utf-8")
        .send(
          page(
            locale,
            publicPageText("testMailTitle", locale),
            `<h1>${escapeHtml(publicPageText("testMailTitle", locale))}</h1><p>${escapeHtml(publicPageText("testMailBody", locale))}</p>`
          )
        );
    }
    const settings = await getSettings(app.db);
    const title = publicPageText("confirmUnsubTitle", locale);
    return reply
      .type("text/html; charset=utf-8")
      .send(
        page(
          locale,
          title,
          `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(settings.unsubscribe_page_text)}</p><form method="post"><button type="submit" style="padding:10px 20px">${escapeHtml(publicPageText("confirmUnsubButton", locale))}</button></form>`
        )
      );
  });

  app.post("/:tracking_id", { config: { public: true } }, async (request, reply) => {
    const locale = localeFromRequest(request);
    const { tracking_id } = request.params as { tracking_id: string };
    const [message] = await app.db.select().from(messages).where(eq(messages.tracking_id, tracking_id));
    if (!message) {
      return reply
        .code(404)
        .type("text/html; charset=utf-8")
        .send(page(locale, publicPageText("invalidLinkTitle", locale), `<h1>${escapeHtml(publicPageText("invalidLinkTitle", locale))}</h1>`));
    }
    if (message.is_test) {
      return reply
        .type("text/html; charset=utf-8")
        .send(
          page(
            locale,
            publicPageText("testMailTitle", locale),
            `<h1>${escapeHtml(publicPageText("testMailTitle", locale))}</h1><p>${escapeHtml(publicPageText("testMailPostBody", locale))}</p>`
          )
        );
    }
    if (message.contact_id) {
      await applyUnsubscribe(app.db, { contact_id: message.contact_id });
    }
    if (oneClick(request.body)) return reply.code(200).send();
    const title = publicPageText("unsubscribedTitle", locale);
    return reply
      .type("text/html; charset=utf-8")
      .send(
        page(
          locale,
          title,
          `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(publicPageText("unsubscribedBody", locale))}</p>`
        )
      );
  });
};
