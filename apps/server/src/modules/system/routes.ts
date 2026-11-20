import type { FastifyPluginAsync } from "fastify";
import { UpdateConfirmBody, UpdateRollbackBody } from "@mailqivo/shared";
import { parseOrThrow } from "../../lib/errors.ts";
import { confirmUpdate, getUpdateCheck, getUpdateTask, retryPlugin, rollbackTask } from "./service.ts";

type IdParams = { Params: { id: string } };

/** 挂载在 /api/system（需要登录）。MCP 不提供更新入口。 */
export const systemRoutes: FastifyPluginAsync = async (app) => {
  app.get("/update", async () => getUpdateCheck(app.db, app.config));
  app.post("/update", async (request) => confirmUpdate(app.db, app.config, parseOrThrow(UpdateConfirmBody, request.body ?? {}).confirm_token));
  app.get<IdParams>("/update/tasks/:id", async (request) => getUpdateTask(request.params.id));
  app.post<IdParams>("/update/tasks/:id/retry-plugin", async (request) => retryPlugin(request.params.id));
  app.post<IdParams>("/update/tasks/:id/rollback", async (request) =>
    rollbackTask(app.db, request.params.id, parseOrThrow(UpdateRollbackBody, request.body ?? {})));
};
