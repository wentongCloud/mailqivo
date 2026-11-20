import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import { createLlmClient, type LlmClient } from "./ai/llm-client.ts";
import type { Config } from "./config.ts";
import { APP_VERSION } from "./version.ts";
import { createDb, type Db } from "./db/client.ts";
import { registerErrorHandlers } from "./lib/errors.ts";
import { localeFromRequest } from "./lib/locale.ts";
import { enterLocale } from "./lib/request-locale.ts";
import { registerAuthHook } from "./modules/auth/plugin.ts";
import { mcpRoutes } from "./mcp/routes.ts";
import { routeModules } from "./modules/index.ts";
import { runsApi } from "./roles.ts";

declare module "fastify" {
  interface FastifyInstance {
    config: Config;
    db: Db;
    /** §8.1 LLM 客户端；null 表示 AI 关闭（LLM_API_KEY 为空且非 mock）。 */
    llm: LlmClient | null;
  }
}

export type BuildAppOptions = {
  config: Config;
  /** 传入则复用（测试可共享连接池）；否则按 DATABASE_URL 创建，并在 app.close() 时关闭 */
  db?: Db;
  logger?: FastifyServerOptions["logger"];
  /** 注入 LLM 客户端（测试记录提示词 / 模拟失败）；缺省按配置创建。 */
  llm?: LlmClient | null;
};

/** 组装 Fastify 实例（不监听端口）。测试中用 `app.inject()` 调用。 */
export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: opts.config.TRUST_PROXY });

  let db = opts.db;
  if (!db) {
    const handle = createDb(opts.config.DATABASE_URL);
    db = handle.db;
    app.addHook("onClose", async () => handle.close());
  }
  app.decorate("config", opts.config);
  app.decorate("db", db);
  app.decorate("llm", opts.llm !== undefined ? opts.llm : createLlmClient(opts.config));

  await app.register(cookie, { secret: opts.config.SESSION_SECRET });
  await app.register(multipart, {
    limits: { fileSize: opts.config.MAX_IMPORT_FILE_MB * 1024 * 1024, files: 1 }
  });
  app.addHook("onRequest", (request, _reply, done) => {
    enterLocale(localeFromRequest(request));
    done();
  });
  registerErrorHandlers(app);
  registerAuthHook(app);
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_request, body, done) => done(null, body));

  // 运行验收用 version 核对实际运行的应用版本（版本更新 §7）。
  app.get("/healthz", async () => ({ ok: true, version: APP_VERSION }));

  for (const mod of routeModules) {
    await app.register(mod.plugin, { prefix: mod.prefix });
  }

  // §2.1 / §10.2：POST /mcp 只在 ROLE=api|all 提供
  if (runsApi(opts.config.ROLE)) await app.register(mcpRoutes, { prefix: "/mcp" });

  return app;
}
