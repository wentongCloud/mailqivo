/**
 * §5.2 错误格式：`{ "error": { "code": ErrorCode, "message": string, "details"?: any } }`
 * HTTP 状态码：VALIDATION→400，UNAUTHORIZED→401，NOT_FOUND→404，INVALID_STATE / CONFIRM_*→409，
 */
import type { FastifyError, FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { errorMessage, type ApiErrorBody, type ErrorCode } from "@mailqivo/shared";
import { currentLocale } from "./request-locale.ts";
import { localeFromRequest } from "./locale.ts";

export const HTTP_STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  INVALID_STATE: 409,
  CONFIRM_REQUIRED: 409,
  CONFIRM_INVALID: 409,
  LIMIT_EXCEEDED: 429,
  NO_UNSUBSCRIBE_LINK: 500,
  CHANNEL_ERROR: 500,
  AI_DISABLED: 500,
  INTERNAL: 500
};

/** 业务代码中抛出的错误，由全局错误处理器转换为 §5.2 格式。 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details: unknown;
  readonly statusCode: number;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
    this.statusCode = HTTP_STATUS_BY_CODE[code];
  }
}

/** 常用错误的快捷构造（默认文案跟随请求 locale） */
export const Errors = {
  validation: (message?: string, details?: unknown) =>
    new AppError("VALIDATION", message ?? errorMessage("validation", currentLocale()), details),
  notFound: (message?: string) =>
    new AppError("NOT_FOUND", message ?? errorMessage("notFound", currentLocale())),
  invalidState: (message: string, details?: unknown) =>
    new AppError("INVALID_STATE", message, details),
  unauthorized: (message?: string) =>
    new AppError("UNAUTHORIZED", message ?? errorMessage("unauthorized", currentLocale())),
  limitExceeded: (message: string, details?: unknown) =>
    new AppError("LIMIT_EXCEEDED", message, details)
};

export function errorBody(
  code: ApiErrorBody["error"]["code"],
  message: string,
  details?: unknown
): ApiErrorBody {
  return details === undefined ? { error: { code, message } } : { error: { code, message, details } };
}

/** 把 zod 的 issues 转成简洁的 details：`[{ path: "a.b", message }]` */
export function zodIssuesToDetails(err: ZodError) {
  return err.issues.map((i) => ({ path: i.path.join("."), message: i.message, code: i.code }));
}

/** 用 zod 解析入参；失败时抛出 VALIDATION（details 中列出每个字段的问题）。 */
export function parseOrThrow<S extends { parse: (v: unknown) => unknown }>(
  schema: S,
  value: unknown
): ReturnType<S["parse"]> {
  try {
    return schema.parse(value) as ReturnType<S["parse"]>;
  } catch (err) {
    if (err instanceof ZodError) {
      throw Errors.validation(undefined, zodIssuesToDetails(err));
    }
    throw err;
  }
}

/** 注册全局错误处理与 404 处理。 */
export function registerErrorHandlers(app: FastifyInstance) {
  app.setErrorHandler((err: FastifyError | AppError | ZodError | Error, request, reply) => {
    const locale = localeFromRequest(request);
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send(errorBody(err.code, err.message, err.details));
    }
    if (err instanceof ZodError) {
      return reply
        .status(400)
        .send(errorBody("VALIDATION", errorMessage("validation", locale), zodIssuesToDetails(err)));
    }
    const statusCode = (err as FastifyError).statusCode;
    if (typeof statusCode === "number" && statusCode >= 400 && statusCode < 500) {
      // Fastify 自身产生的客户端错误（JSON 格式错误、请求体过大、schema 校验失败等）
      // SPEC-GAP: 规格未区分这些情况，统一按 VALIDATION→400 返回。
      return reply.status(400).send(errorBody("VALIDATION", err.message));
    }
    request.log.error({ err }, "unhandled error");
    return reply.status(500).send(errorBody("INTERNAL", errorMessage("internal", locale)));
  });

  app.setNotFoundHandler((request, reply) => {
    const locale = localeFromRequest(request);
    reply
      .status(404)
      .send(
        errorBody(
          "NOT_FOUND",
          errorMessage("routeNotFound", locale, { method: request.method, url: request.url })
        )
      );
  });
}
