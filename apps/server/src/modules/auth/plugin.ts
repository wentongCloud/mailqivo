/**
 * 鉴权钩子：除标记为 `config: { public: true }` 的路由外，所有 `/api/*` 都要求登录（§5.1）。
 * 非 /api 路由（/healthz、/t、/u、/mcp）不经过此检查；/mcp 的 Bearer 鉴权在 T12 实现。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { SESSION_COOKIE_NAME } from "@mailqivo/shared";
import { Errors } from "../../lib/errors.ts";
import { isSessionValueValid } from "./service.ts";

declare module "fastify" {
  interface FastifyContextConfig {
    /** 为 true 时 /api 路由无需登录 */
    public?: boolean;
  }
}

export function hasValidSession(request: FastifyRequest): boolean {
  const raw = request.cookies[SESSION_COOKIE_NAME];
  if (!raw) return false;
  const unsigned = request.unsignCookie(raw);
  return unsigned.valid && unsigned.value !== null && isSessionValueValid(unsigned.value);
}

export function registerAuthHook(app: FastifyInstance) {
  app.addHook("onRequest", async (request) => {
    if (!request.url.startsWith("/api/") && request.url !== "/api") return;
    if (request.routeOptions.config?.public) return;
    if (!hasValidSession(request)) {
      throw Errors.unauthorized();
    }
  });
}
