import type { FastifyPluginAsync } from "fastify";
import { FieldMapping, ImportCommitBody } from "@mailqivo/shared";
import { AppError, Errors, parseOrThrow } from "../../lib/errors.ts";
import { buildProblemRowsCsv, commitImport, createImport, updateImportMapping } from "./service.ts";

function invalidMultipart(err: unknown): never {
  if (err instanceof AppError) throw err;
  if (typeof err === "object" && err && "code" in err && err.code === "FST_REQ_FILE_TOO_LARGE") {
    throw Errors.limitExceeded("导入文件超过大小限制");
  }
  throw err;
}

export const importRoutes: FastifyPluginAsync = async (app) => {
  app.post("/", async (request, reply) => {
    try {
      let file: { filename: string; buffer: Buffer } | null = null;
      let mappingText: string | undefined;
      for await (const part of request.parts()) {
        if (part.type === "file") {
          if (file) throw Errors.validation("一次只能上传一个文件");
          file = { filename: part.filename, buffer: await part.toBuffer() };
        } else if (part.fieldname === "field_mapping") {
          mappingText = String(part.value);
        }
      }
      if (!file) throw Errors.validation("请上传导入文件");
      let field_mapping: unknown;
      if (mappingText) {
        try {
          field_mapping = JSON.parse(mappingText);
        } catch {
          throw Errors.validation("field_mapping 必须是合法 JSON");
        }
      }
      const result = await createImport(app.db, {
        filename: file.filename,
        buffer: file.buffer,
        field_mapping: field_mapping ? parseOrThrow(FieldMapping, field_mapping) : undefined,
        max_rows: app.config.MAX_IMPORT_ROWS
      });
      reply.status(201);
      return result;
    } catch (err) {
      invalidMultipart(err);
    }
  });

  app.put<{ Params: { id: string } }>("/:id/mapping", async (request) => {
    return updateImportMapping(app.db, request.params.id, parseOrThrow(FieldMapping, request.body), app.config.MAX_IMPORT_ROWS);
  });

  app.get<{ Params: { id: string } }>("/:id/problem-rows.csv", async (request, reply) => {
    const buffer = await buildProblemRowsCsv(app.db, request.params.id);
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", 'attachment; filename="problem-rows.csv"')
      .send(buffer);
  });

  app.post<{ Params: { id: string } }>("/:id/commit", async (request) => {
    return commitImport(app.db, request.params.id, parseOrThrow(ImportCommitBody, request.body));
  });
};
