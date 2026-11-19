/** T05 发送通道：配置只写入，API 响应不包含密码或密文。 */
import { z } from "zod";
import { EmailInput } from "./contacts.ts";

const MailServerInput = z.object({
  host: z.string().trim().min(1, "请输入主机").max(255),
  port: z.coerce.number().int().min(1).max(65535),
  secure: z.boolean(),
  user: z.string().trim().max(320),
  pass: z.string().max(1024)
});

export const ChannelConfig = z.object({
  smtp: MailServerInput,
  imap: MailServerInput
});
export type ChannelConfig = z.infer<typeof ChannelConfig>;

export const ChannelBody = ChannelConfig.extend({
  name: z.string().trim().min(1, "请输入通道名称").max(100),
  /** 固定 smtp，API 可省略；服务端写入时亦强制 smtp。 */
  type: z.literal("smtp").default("smtp"),
  from_email: EmailInput,
  from_name: z.string().trim().min(1, "请输入发件人名称").max(200),
  reply_to: EmailInput,
  /** 企业邮箱（Gmail / Outlook / 飞书 / 163 等）建议 30。 */
  rate_per_minute: z.coerce.number().int().min(1).max(10000).default(30),
  /**
   * 日发送上限。企业邮箱建议 300；`0` = 商用发信通道无日额度限制。
   */
  daily_limit: z.coerce.number().int().min(0).max(1000000).default(300),
  is_default: z.boolean().default(false)
}).superRefine((body, ctx) => {
  const imapUser = body.imap.user.trim();
  if (imapUser && body.reply_to.trim().toLowerCase() !== imapUser.toLowerCase()) {
    ctx.addIssue({ code: "custom", path: ["reply_to"], message: "Reply-To 必须与 IMAP 轮询邮箱一致" });
  }
});
export type ChannelBody = z.infer<typeof ChannelBody>;

export type ChannelDto = Omit<ChannelBody, "smtp" | "imap"> & {
  id: string;
  smtp: Omit<ChannelConfig["smtp"], "pass">;
  imap: Omit<ChannelConfig["imap"], "pass">;
  created_at: string;
  updated_at: string;
};

export type ChannelVerifyResult = {
  smtp: boolean;
  imap: boolean;
  error?: string;
};
