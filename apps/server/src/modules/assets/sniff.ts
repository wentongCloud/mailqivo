/**
 * §10.1 上传校验：扩展名与内容嗅探必须同时属于允许名单且互相一致。
 * docx / xlsx / pptx 是 zip 容器，由 file-type 按 OOXML 部件（[Content_Types].xml、word/ xl/ ppt/）识别，
 * 普通 zip、doc/xls/ppt（OLE）、可执行文件等都会被识别为别的类型而被拒绝。
 */
import { fileTypeFromBuffer } from "file-type";
import { ASSET_EXTENSIONS, type AssetExtension } from "@mailqivo/shared";

export const ASSET_MIME: Record<AssetExtension, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  csv: "text/csv",
  txt: "text/plain",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg"
};

/** 嗅探出的 file-type 扩展名 → 允许的上传扩展名集合 */
const SNIFF_TO_EXT: Record<string, AssetExtension[]> = {
  pdf: ["pdf"],
  docx: ["docx"],
  xlsx: ["xlsx"],
  pptx: ["pptx"],
  png: ["png"],
  jpg: ["jpg", "jpeg"]
};

export type SniffFailure =
  | "EMPTY"
  | "EXTENSION_NOT_ALLOWED"
  | "CONTENT_NOT_ALLOWED"
  | "CONTENT_MISMATCH";

export type SniffResult =
  | { ok: true; ext: AssetExtension; mime: string }
  | { ok: false; reason: SniffFailure; detected?: string };

export function extensionOf(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx <= 0 ? "" : filename.slice(idx + 1).toLowerCase();
}

/** 纯文本：不含 NUL 与除 \t \n \r \f 外的控制字符（编码不限，UTF-8 / GBK 均可）。 */
function looksLikeText(buffer: Buffer): boolean {
  for (const byte of buffer) {
    if (byte === 0) return false;
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d && byte !== 0x0c) return false;
  }
  return true;
}

export async function sniffAsset(filename: string, buffer: Buffer): Promise<SniffResult> {
  if (buffer.length === 0) return { ok: false, reason: "EMPTY" };
  const ext = extensionOf(filename);
  if (!(ASSET_EXTENSIONS as readonly string[]).includes(ext)) return { ok: false, reason: "EXTENSION_NOT_ALLOWED", detected: ext };
  const allowedExt = ext as AssetExtension;
  const detected = await fileTypeFromBuffer(buffer);
  if (ext === "csv" || ext === "txt") {
    // 文本没有魔数：任何被识别出的二进制类型（zip、pdf、可执行文件…）都算不符。
    if (detected) return { ok: false, reason: "CONTENT_MISMATCH", detected: detected.ext };
    if (!looksLikeText(buffer)) return { ok: false, reason: "CONTENT_MISMATCH" };
    return { ok: true, ext: allowedExt, mime: ASSET_MIME[allowedExt] };
  }
  if (!detected) return { ok: false, reason: "CONTENT_NOT_ALLOWED" };
  const allowedForDetected = SNIFF_TO_EXT[detected.ext];
  if (!allowedForDetected) return { ok: false, reason: "CONTENT_NOT_ALLOWED", detected: detected.ext };
  if (!allowedForDetected.includes(allowedExt)) return { ok: false, reason: "CONTENT_MISMATCH", detected: detected.ext };
  return { ok: true, ext: allowedExt, mime: ASSET_MIME[allowedExt] };
}
