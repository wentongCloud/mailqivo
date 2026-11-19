import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { CampaignBody, CampaignConfirmBody, CampaignPreviewBody, CampaignMessageQuery, CampaignSendBody, CampaignTestSendBody, RequeueUnknownBody } from "@mailqivo/shared";
import { parseOrThrow } from "../../lib/errors.ts";
import { improveDraft } from "./improve.ts";
import { parsePagination } from "../../lib/pagination.ts";
import { cancelCampaign, createCampaign, deleteCampaign, getCampaign, listCampaigns, pauseCampaign, requeueUnknownMessages, resumeCampaign, sendCampaign, updateCampaign } from "./service.ts";
import { getCampaignOpensByHour, getCampaignStats, listCampaignMessages } from "./stats.ts";
import { previewCampaign } from "./preview.ts";
import { testSendCampaign } from "./test-send.ts";

type IdParams = { Params: { id: string } };

export const campaignRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (request) => listCampaigns(app.db, parsePagination(request.query)));
  app.post("/", async (request, reply) => {
    reply.status(201);
    return createCampaign(app.db, parseOrThrow(CampaignBody, request.body), app.config);
  });
  app.get<IdParams>("/:id", async (request) => getCampaign(app.db, request.params.id));
  app.get<IdParams>("/:id/stats", async (request) => getCampaignStats(app.db, request.params.id));
  app.get<IdParams>("/:id/stats/opens-by-hour", async (request) => getCampaignOpensByHour(app.db, request.params.id, (request.query as { include_suspect?: string }).include_suspect === "1"));
  app.get<IdParams>("/:id/messages", async (request) => listCampaignMessages(app.db, request.params.id, parseOrThrow(CampaignMessageQuery, request.query), parsePagination(request.query)));
  app.patch<IdParams>("/:id", async (request) => updateCampaign(app.db, request.params.id, parseOrThrow(CampaignBody, request.body), app.config));
  app.delete<IdParams>("/:id", async (request) => {
    await deleteCampaign(app.db, request.params.id);
    return { ok: true };
  });
  app.post<IdParams>("/:id/send", async (request) => sendCampaign(app.db, request.params.id, parseOrThrow(CampaignSendBody, request.body), app.config));
  app.post("/improve-draft", async (request) => {
    const body = parseOrThrow(z.object({ html: z.string().max(500_000), instruction: z.string().trim().min(1).max(2000) }), request.body);
    return { html: await improveDraft(app.llm, body.html, body.instruction) };
  });
  app.post<IdParams>("/:id/preview", async (request) => previewCampaign(app.db, app.config, app.llm, request.params.id, parseOrThrow(CampaignPreviewBody, request.body ?? {})));
  app.post<IdParams>("/:id/test-send", async (request) => testSendCampaign(app.db, request.params.id, parseOrThrow(CampaignTestSendBody, request.body), app.config));
  app.post<IdParams>("/:id/pause", async (request) => pauseCampaign(app.db, request.params.id));
  app.post<IdParams>("/:id/resume", async (request) => resumeCampaign(app.db, request.params.id));
  app.post<IdParams>("/:id/messages/requeue-unknown", async (request) => requeueUnknownMessages(app.db, request.params.id, parseOrThrow(RequeueUnknownBody, request.body ?? {})));
  app.post<IdParams>("/:id/cancel", async (request) => cancelCampaign(app.db, request.params.id, parseOrThrow(CampaignConfirmBody, request.body).confirm_token));
};
