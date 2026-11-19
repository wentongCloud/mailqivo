import type { FastifyPluginAsync } from "fastify";
import { SignatureBody } from "@mailqivo/shared";
import { parseOrThrow } from "../../lib/errors.ts";
import { createSignature, deleteSignature, getSignature, listSignatures, updateSignature } from "./service.ts";

export const signatureRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async () => ({ items: await listSignatures(app.db) }));
  app.post("/", async (request, reply) => {
    reply.status(201);
    return createSignature(app.db, parseOrThrow(SignatureBody, request.body));
  });
  app.get<{ Params: { id: string } }>("/:id", async (request) => getSignature(app.db, request.params.id));
  app.patch<{ Params: { id: string } }>("/:id", async (request) =>
    updateSignature(app.db, request.params.id, parseOrThrow(SignatureBody, request.body))
  );
  app.delete<{ Params: { id: string } }>("/:id", async (request) => {
    await deleteSignature(app.db, request.params.id);
    return { ok: true };
  });
};
