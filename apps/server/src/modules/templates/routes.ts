import type { FastifyPluginAsync } from "fastify";
import { TemplateBody } from "@mailqivo/shared";
import { parseOrThrow } from "../../lib/errors.ts";
import { createTemplate, deleteTemplate, getTemplate, listTemplates, updateTemplate } from "./service.ts";

export const templateRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async () => ({ items: await listTemplates(app.db) }));
  app.post("/", async (request, reply) => {
    reply.status(201);
    return createTemplate(app.db, parseOrThrow(TemplateBody, request.body));
  });
  app.get<{ Params: { id: string } }>("/:id", async (request) => getTemplate(app.db, request.params.id));
  app.patch<{ Params: { id: string } }>("/:id", async (request) =>
    updateTemplate(app.db, request.params.id, parseOrThrow(TemplateBody, request.body))
  );
  app.delete<{ Params: { id: string } }>("/:id", async (request) => {
    await deleteTemplate(app.db, request.params.id);
    return { ok: true };
  });
};
