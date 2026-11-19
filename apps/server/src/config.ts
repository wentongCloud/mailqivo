/**
 * §2.1 环境变量：用 zod 解析，缺失或非法即退出（见 index.ts）。
 * 配置对象的键与环境变量名逐字一致。
 */
import { z } from "zod";
import { ServerRoleSchema } from "@mailqivo/shared";

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const required = () => z.string().min(1, "必填");
const intWithDefault = (def: number) => z.coerce.number().int().positive().default(def);

const httpUrl = z
  .url({ protocol: /^https?$/ })
  .transform((v) => v.replace(/\/+$/, ""));

const publicHttpsUrl = z.url({ protocol: /^https$/ })
  .refine((value) => {
    if (!URL.canParse(value)) return false;
    const { hostname, username, password, search, hash } = new URL(value);
    return !username && !password && !search && !hash && hostname.includes(".") &&
      !hostname.endsWith(".localhost") && !hostname.endsWith(".local") && !/^[\d.]+$/.test(hostname);
  }, "需要公网 HTTPS 服务域名");

export const ConfigSchema = z
  .object({
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    PUBLIC_BASE_URL: httpUrl,
    MAIL_PUBLIC_BASE_URL: publicHttpsUrl.transform((value) => value.replace(/\/+$/, "")).optional(),
    UNSUBSCRIBE_PUBLIC_URL: publicHttpsUrl.optional(),
    UNSUBSCRIBE_SHARED_SECRET: z.string().refine((value) => Buffer.byteLength(value, "utf8") >= 32,
      "密钥至少 32 字节").optional(),
    MAIL_ID_DOMAIN: required(),
    APP_ENCRYPTION_KEY: required().refine(
      (v) => Buffer.from(v, "base64").length === 32,
      "必须是 32 字节密钥的 base64"
    ),
    ADMIN_PASSWORD: required(),
    SESSION_SECRET: required(),
    MCP_TOKEN: required(),
    APP_TIMEZONE: z
      .string()
      .default("Asia/Shanghai")
      .refine((tz) => {
        try {
          new Intl.DateTimeFormat("en-US", { timeZone: tz });
          return true;
        } catch {
          return false;
        }
      }, "不是有效的 IANA 时区"),
    ROLE: ServerRoleSchema.default("all"),
    SERVER_HOST: z.string().min(1).default("0.0.0.0"),
    SERVER_PORT: z.coerce.number().int().min(1).max(65535).default(18091),
    SERVER_INTERNAL_URL: httpUrl.default("http://localhost:18091"),
    LLM_BASE_URL: httpUrl.default("https://api.moonshot.cn/v1"),
    LLM_API_KEY: z.string().optional(),
    LLM_MODEL: z.string().optional(),
    LLM_CONCURRENCY: intWithDefault(5),
    LLM_MOCK: z
      .enum(["0", "1"])
      .default("0")
      .transform((v) => v === "1"),
    SEND_WORKER_CONCURRENCY: intWithDefault(4),
    IMAP_POLL_INTERVAL_SEC: intWithDefault(300),
    MAX_IMPORT_FILE_MB: intWithDefault(10),
    MAX_IMPORT_ROWS: intWithDefault(100000),
    ASSET_DIR: required(),
    /** 仅在确认有反向代理时设为 1；裸暴露进程时保持 0，避免伪造 X-Forwarded-For。 */
    TRUST_PROXY: z
      .enum(["0", "1"])
      .default("0")
      .transform((v) => v === "1")
  })
  .superRefine((cfg, ctx) => {
    if (cfg.LLM_API_KEY && !cfg.LLM_MODEL) {
      ctx.addIssue({
        code: "custom",
        path: ["LLM_MODEL"],
        message: "设置了 LLM_API_KEY 时必填"
      });
    }
  });

export type Config = z.infer<typeof ConfigSchema>;

export class ConfigError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`环境变量配置错误：\n${issues.map((i) => `  - ${i}`).join("\n")}`);
    this.name = "ConfigError";
    this.issues = issues;
  }
}

/** 解析环境变量；不合法时抛出 ConfigError。空字符串视为未设置。 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const input: Record<string, unknown> = {};
  for (const key of Object.keys(ConfigSchema.shape)) {
    input[key] = emptyToUndefined(env[key]);
  }
  const result = ConfigSchema.safeParse(input);
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    );
  }
  return result.data;
}
