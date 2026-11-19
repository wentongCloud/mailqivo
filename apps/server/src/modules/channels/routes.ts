import type { FastifyPluginAsync } from "fastify";
import { ChannelBody } from "@mailqivo/shared";
import { parseOrThrow } from "../../lib/errors.ts";
import { createChannel, deleteChannel, getChannel, listChannels, updateChannel, verifyChannel } from "./service.ts";

export const channelRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async () => ({ items: await listChannels(app.db, app.config) }));
  app.post("/", async (request, reply) => {
    reply.status(201);
    return createChannel(app.db, parseOrThrow(ChannelBody, request.body), app.config);
  });
  app.get<{ Params: { id: string } }>("/:id", async (request) => getChannel(app.db, request.params.id, app.config));
  app.patch<{ Params: { id: string } }>("/:id", async (request) =>
    updateChannel(app.db, request.params.id, parseOrThrow(ChannelBody, request.body), app.config)
  );
  app.delete<{ Params: { id: string } }>("/:id", async (request) => {
    await deleteChannel(app.db, request.params.id);
    return { ok: true };
  });
  app.post<{ Params: { id: string } }>("/:id/verify", async (request) => verifyChannel(app.db, request.params.id, app.config));
};
