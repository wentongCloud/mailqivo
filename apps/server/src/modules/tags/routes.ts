import type { FastifyPluginAsync } from "fastify";
import { TagBody } from "@mailqivo/shared";
import { parseOrThrow } from "../../lib/errors.ts";
import { createTag, deleteTag, listTags, renameTag } from "./service.ts";

/** 挂载在 /api/tags 下（§10.1） */
export const tagRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async () => ({ items: await listTags(app.db) }));

  app.post("/", async (request, reply) => {
    const { name } = parseOrThrow(TagBody, request.body);
    reply.status(201);
    return createTag(app.db, name);
  });

  app.patch<{ Params: { id: string } }>("/:id", async (request) => {
    const { name } = parseOrThrow(TagBody, request.body);
    return renameTag(app.db, request.params.id, name);
  });

  app.delete<{ Params: { id: string } }>("/:id", async (request) => {
    await deleteTag(app.db, request.params.id);
    return { ok: true };
  });
};
