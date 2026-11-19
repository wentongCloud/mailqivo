import type { FastifyPluginAsync } from "fastify";
import { LoginBody, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SEC } from "@mailqivo/shared";
import { Errors, parseOrThrow } from "../../lib/errors.ts";
import { createSessionValue, verifyPassword } from "./service.ts";

/** 挂载在 /api/auth 下（见 modules/index.ts） */
export const authRoutes: FastifyPluginAsync = async (app) => {
  const secure = app.config.PUBLIC_BASE_URL.startsWith("https://");
  const cookieOptions = {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure
  };

  app.post("/login", { config: { public: true } }, async (request, reply) => {
    const { password } = parseOrThrow(LoginBody, request.body);
    if (!verifyPassword(password, app.config.ADMIN_PASSWORD)) {
      throw Errors.unauthorized("密码错误");
    }
    reply.setCookie(SESSION_COOKIE_NAME, createSessionValue(), {
      ...cookieOptions,
      signed: true,
      maxAge: SESSION_MAX_AGE_SEC
    });
    return { ok: true };
  });

  app.post("/logout", { config: { public: true } }, async (_request, reply) => {
    reply.clearCookie(SESSION_COOKIE_NAME, cookieOptions);
    return { ok: true };
  });

  // SPEC-GAP: §10.1 未列出此接口。用于前端确认会话是否有效，也是最简单的“需要登录的接口”。
  app.get("/me", async () => ({ authenticated: true }));
};
