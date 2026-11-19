import { z } from "zod";

/** §10.1 附件资产允许的扩展名（小写）。 */
export const ASSET_EXTENSIONS = ["pdf", "docx", "xlsx", "pptx", "csv", "txt", "png", "jpg", "jpeg"] as const;
export type AssetExtension = (typeof ASSET_EXTENSIONS)[number];

/** 资产元数据（不含 storage_key；不提供下载）。 */
export type AssetDto = {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  enabled: boolean;
  created_at: string;
};

/** §6.3 attachment_snapshot 的单项。 */
export type AttachmentSnapshotItem = {
  asset_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
};

export const AssetListQuery = z.object({
  enabled: z.enum(["true", "false"]).optional()
});
