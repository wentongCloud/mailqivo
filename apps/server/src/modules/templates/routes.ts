import type { FastifyPluginAsync } from "fastify";
import { TemplateBody, TemplateDiagnoseBody, type TemplateDiagnosis } from "@mailqivo/shared";
import { parseOrThrow } from "../../lib/errors.ts";
import { diagnoseTemplate } from "./diagnose.ts";
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
  app.post<{ Params: { id: string } }>("/:id/diagnose", async (request): Promise<TemplateDiagnosis> => {
    const body = parseOrThrow(TemplateDiagnoseBody, request.body ?? {});
    // 模板须存在；诊断对象为请求携带的、本次实际套用的正文。
    await getTemplate(app.db, request.params.id);
    return { issues: await diagnoseTemplate(app.db, body.html, body.ai_block_keys) };
  });
  app.delete<{ Params: { id: string } }>("/:id", async (request) => {
    await deleteTemplate(app.db, request.params.id);
    return { ok: true };
  });
};
