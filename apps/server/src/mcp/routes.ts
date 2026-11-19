/**
 * `POST /mcp`：Streamable HTTP（无状态：每个请求一个 Server + Transport），Bearer `MCP_TOKEN` 鉴权（§5.1）。
 * 只在 ROLE=api|all 时注册（app.ts）。
 */
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { FastifyPluginAsync } from "fastify";
import { MCP_ASSET_MAX_BYTES } from "@mailqivo/shared";
import { bearerMatches } from "../lib/bearer.ts";
import { Errors } from "../lib/errors.ts";
import { createMcpServer } from "./server.ts";

const methodNotAllowed = { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null };

export const mcpRoutes: FastifyPluginAsync = async (app) => {
  // onRequest：先于请求体解析鉴权，错误或缺失的 token 一律 401
  app.addHook("onRequest", async (request) => {
    if (!bearerMatches(request.headers.authorization, app.config.MCP_TOKEN)) throw Errors.unauthorized("Token 无效");
  });

  // base64 文件（导入 / 附件）要放进 JSON-RPC 请求体：按较大者的 4/3 再留 64KB 余量
  const bodyLimit = Math.ceil((Math.max(app.config.MAX_IMPORT_FILE_MB * 1024 * 1024, MCP_ASSET_MAX_BYTES) * 4) / 3) + 64 * 1024;

  app.post("/", { bodyLimit }, async (request, reply) => {
    reply.hijack();
    const server = createMcpServer({ db: app.db, config: app.config, llm: app.llm }, request.log);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    reply.raw.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(request.raw, reply.raw, request.body);
  });

  // 无状态模式不提供服务端推送流与会话终止
  for (const method of ["GET", "DELETE"] as const) {
    app.route({ method, url: "/", handler: async (_request, reply) => reply.status(405).header("allow", "POST").send(methodNotAllowed) });
  }
};
