import type { FastifyPluginAsync } from "fastify";
import { ReplyPatchBody } from "@mailqivo/shared";
import { parseOrThrow } from "../../lib/errors.ts";
import { getReply, listReplies, updateReply } from "./service.ts";

type IdParams = { Params: { id: string } };

export const replyRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (request) => listReplies(app.db, request.query));
  app.get<IdParams>("/:id", async (request) => getReply(app.db, request.params.id));
  app.patch<IdParams>("/:id", async (request) => updateReply(app.db, request.params.id, parseOrThrow(ReplyPatchBody, request.body)));
};
