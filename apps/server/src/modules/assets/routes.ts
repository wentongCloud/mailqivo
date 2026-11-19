import type { FastifyPluginAsync } from "fastify";
import { AssetListQuery } from "@mailqivo/shared";
import { AppError, Errors, parseOrThrow } from "../../lib/errors.ts";
import { getAttachmentMaxTotalMb } from "../settings/service.ts";
import { createAsset, disableAsset, getAsset, listAssets, maxRawBytesForMb } from "./service.ts";

/** §10.1：只返回元数据，不提供下载与更新接口。 */
export const assetRoutes: FastifyPluginAsync = async (app) => {
  app.post("/", async (request, reply) => {
    if (!request.isMultipart()) throw Errors.validation("请以 multipart/form-data 上传文件");
    const maxRaw = maxRawBytesForMb(await getAttachmentMaxTotalMb(app.db));
    let file: { filename: string; buffer: Buffer } | null = null;
    try {
      // preservePath：保留客户端文件名中的路径部分，交给 validateFilename 拒绝路径穿越。
      for await (const part of request.parts({ limits: { fileSize: maxRaw + 1, files: 1 }, preservePath: true })) {
        if (part.type !== "file") continue;
        if (file) throw Errors.validation("一次只能上传一个文件");
        const buffer = await part.toBuffer();
        if (part.file.truncated || buffer.length > maxRaw) {
          throw Errors.validation("文件编码后超过大小上限", { reason: "TOO_LARGE" });
        }
        file = { filename: part.filename, buffer };
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
      const code = (err as { code?: string }).code;
      if (code === "FST_REQ_FILE_TOO_LARGE" || code === "FST_FILES_LIMIT") {
        throw Errors.validation("文件编码后超过大小上限", { reason: "TOO_LARGE" });
      }
      throw err;
    }
    if (!file) throw Errors.validation("请上传附件文件");
    reply.status(201);
    return createAsset(app.db, app.config, file);
  });

  app.get("/", async (request) => {
    const query = parseOrThrow(AssetListQuery, request.query ? { enabled: (request.query as Record<string, unknown>).enabled } : {});
    return { items: await listAssets(app.db, { enabled: query.enabled === undefined ? undefined : query.enabled === "true" }) };
  });
  app.get<{ Params: { id: string } }>("/:id", async (request) => getAsset(app.db, request.params.id));
  app.post<{ Params: { id: string } }>("/:id/disable", async (request) => disableAsset(app.db, request.params.id));
};
