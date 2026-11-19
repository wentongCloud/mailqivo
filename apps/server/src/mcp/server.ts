/**
 * MCP Server（低层 API）：tools/list 的 inputSchema 由 shared 的 zod schema 转换；tools/call 统一做
 * 入参校验与错误映射（§9：成功 text=JSON.stringify(result)；失败 isError:true，text={code,message}）。
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z, ZodError } from "zod";
import { AppError, Errors, parseOrThrow } from "../lib/errors.ts";
import { MCP_TOOLS, type McpContext, type McpTool } from "./tools.ts";
import {
  WORKSPACE_HTML,
  WORKSPACE_MIME_TYPE,
  WORKSPACE_OPEN_WEB_TOOL,
  WORKSPACE_OPEN_WEB_TOOL_NAME,
  WORKSPACE_RESOURCE_URI,
  WORKSPACE_TOOL,
  WORKSPACE_TOOL_NAME,
  WORKSPACE_WEB_URL
} from "./workspace.ts";

type JsonSchema = Record<string, unknown>;

function inputSchemaOf(tool: McpTool): JsonSchema {
  const schema = z.toJSONSchema(tool.schema, { io: "input", unrepresentable: "any", target: "draft-7" }) as JsonSchema;
  delete schema.$schema;
  return schema;
}

const failure = (code: string, message: string, details?: unknown) => ({
  isError: true as const,
  content: [{ type: "text" as const, text: JSON.stringify(details === undefined ? { code, message } : { code, message, details }) }]
});

const execFileAsync = promisify(execFile);

export function openWorkspaceWeb(platform = process.platform, run = execFileAsync) {
  if (platform === "win32") {
    return run("rundll32.exe", ["url.dll,FileProtocolHandler", WORKSPACE_WEB_URL], { timeout: 5_000 });
  }
  return run(platform === "darwin" ? "/usr/bin/open" : "xdg-open", [WORKSPACE_WEB_URL], { timeout: 5_000 });
}

export function createMcpServer(ctx: McpContext, log: { error: (obj: unknown, msg: string) => void }): Server {
  const server = new Server({ name: "mailqivo", version: "0.2.7" }, { capabilities: { tools: {}, resources: {} } });
  const tools = new Map(MCP_TOOLS.map((tool) => [tool.name as string, tool]));
  const listed: Tool[] = [
    ...MCP_TOOLS.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: inputSchemaOf(tool) as { type: "object" } })),
    WORKSPACE_TOOL,
    WORKSPACE_OPEN_WEB_TOOL
  ];

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: listed }));
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [{
      uri: WORKSPACE_RESOURCE_URI,
      name: "Mailqivo 工作空间",
      description: "Mailqivo 邮件营销工作空间",
      mimeType: WORKSPACE_MIME_TYPE
    }]
  }));
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    if (request.params.uri !== WORKSPACE_RESOURCE_URI) {
      throw new McpError(ErrorCode.InvalidRequest, `未知资源：${request.params.uri}`);
    }
    return {
      contents: [{
        uri: WORKSPACE_RESOURCE_URI,
        mimeType: WORKSPACE_MIME_TYPE,
        text: WORKSPACE_HTML,
        _meta: {
          ui: {
            prefersBorder: false
          },
          "openai/ui": {
            availableDisplayModes: ["fullscreen"],
            preferredDisplayMode: "fullscreen"
          }
        }
      }]
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === WORKSPACE_TOOL_NAME) return { content: [] };
    if (request.params.name === WORKSPACE_OPEN_WEB_TOOL_NAME) {
      try {
        await openWorkspaceWeb();
        return { content: [{ type: "text" as const, text: JSON.stringify({ opened: true, url: WORKSPACE_WEB_URL }) }] };
      } catch (err) {
        log.error({ err, tool: WORKSPACE_OPEN_WEB_TOOL_NAME }, "failed to open Mailqivo Web console");
        return failure("INTERNAL", "无法打开默认浏览器");
      }
    }
    const tool = tools.get(request.params.name);
    if (!tool) return failure("NOT_FOUND", `未知工具：${request.params.name}`);
    const raw = (request.params.arguments ?? {}) as Record<string, unknown>;
    try {
      const args = parseOrThrow(tool.schema, raw);
      const result = await tool.handler(ctx, args, raw);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (err) {
      if (err instanceof AppError) return failure(err.code, err.message, err.details);
      if (err instanceof ZodError) {
        const e = Errors.validation();
        return failure(e.code, e.message, err.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
      }
      log.error({ err, tool: tool.name }, "mcp tool failed");
      // SPEC-GAP: 与 REST 一致，ErrorCode 没有“内部错误”，未预期异常使用 code "INTERNAL"。
      return failure("INTERNAL", "服务器内部错误");
    }
  });

  return server;
}
