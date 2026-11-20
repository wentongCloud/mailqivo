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

const isApiPath = (path: string | undefined) => !!path && (path === "/api" || path.startsWith("/api/"));

export function registerAuthHook(app: FastifyInstance) {
  app.addHook("onRequest", async (request) => {
    // 以路由器实际匹配的路由为准：原始 URL 可用百分号编码（如 /%61pi/...）绕过前缀判断。
    // 原始 URL 仍参与判断，使未匹配的 /api 路径继续返回 401 而不是 404。
    if (!isApiPath(request.routeOptions.url) && !isApiPath(request.url)) return;
    if (request.routeOptions.config?.public) return;
    if (!hasValidSession(request)) {
      throw Errors.unauthorized();
    }
  });
}
