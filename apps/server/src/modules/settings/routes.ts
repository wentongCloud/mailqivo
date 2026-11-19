import type { FastifyPluginAsync } from "fastify";
import { SettingsBody } from "@mailqivo/shared";
import { parseOrThrow } from "../../lib/errors.ts";
import { getSettings, updateSettings } from "./service.ts";

export const settingsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async () => getSettings(app.db));
  app.patch("/", async (request) => updateSettings(app.db, parseOrThrow(SettingsBody.partial(), request.body)));
  app.put("/", async (request) => updateSettings(app.db, parseOrThrow(SettingsBody, request.body)));
};
