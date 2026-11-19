/**
 * §5.3 联系人筛选 ContactFilter。除 `include_contact_ids` 外，条件之间是 AND。
 * `include_contact_ids` 在 AND 结果之外并入（仍受 statuses 约束），
 * 然后 `exclude_contact_ids` 从两边一起剔除。
 * 服务端的 buildContactWhere(filter) 在 T02 实现。
 */
import { z } from "zod";
import { CONTACT_STATUS_VALUES } from "./enums.ts";

const contactIdList = z.array(z.string().uuid()).max(10000).optional();

export const ContactFilter = z.object({
  contact_ids: contactIdList,
  tags_any: z.array(z.string()).optional(), // 标签名，命中任一
  tags_all: z.array(z.string()).optional(), // 标签名，全部命中
  statuses: z.array(z.enum(CONTACT_STATUS_VALUES)).default(["active"]),
  domains: z.array(z.string()).optional(), // 邮箱域名
  keyword: z.string().optional(), // 在 email/name/company 上做 ILIKE
  import_batch_id: z.string().uuid().optional(),
  exclude_domain_suspect: z.boolean().default(false),
  /** 通讯录自定义字段 industry，精确匹配。 */
  industry: z.string().trim().min(1).max(100).optional(),
  /** 从本次结果中剔除的联系人。 */
  exclude_contact_ids: contactIdList,
  /** 在筛选结果之外额外纳入的联系人（仍须符合 statuses）。 */
  include_contact_ids: contactIdList
});

/** 解析后的类型（默认值已填充） */
export type ContactFilter = z.infer<typeof ContactFilter>;
/** 入参类型（带默认值的字段可省略） */
export type ContactFilterInput = z.input<typeof ContactFilter>;
