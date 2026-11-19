import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

export const root = fileURLToPath(new URL("../", import.meta.url));
export const webOrigin = "http://127.0.0.1:19490";
export const apiOrigin = "http://127.0.0.1:19491";

export function readDemoSettings() {
  const source = readFileSync(new URL("../.env", import.meta.url), "utf8");
  const settings = parseEnv(source);
  if (!source.startsWith("# Mailqivo isolated demo\n") ||
      !/^postgresql:\/\/mailqivo_demo:[a-f0-9]{64}@127\.0\.0\.1:19492\/mailqivo_demo$/.test(settings.DATABASE_URL ?? "") ||
      settings.PUBLIC_BASE_URL !== webOrigin ||
      settings.SERVER_INTERNAL_URL !== apiOrigin ||
      settings.SERVER_HOST !== "127.0.0.1" ||
      settings.SERVER_PORT !== "19491" ||
      settings.ASSET_DIR !== ".demo-assets" ||
      settings.ROLE !== "api" ||
      settings.LLM_MOCK !== "1" ||
      settings.MAIL_ID_DOMAIN !== "example.com" ||
      !/^[a-f0-9]{64}$/.test(settings.ADMIN_PASSWORD ?? "") ||
      Object.keys(settings).length !== 14) {
    throw new Error("The local configuration is not an isolated demo. Run node demo/prepare.mjs in a fresh checkout.");
  }
  return settings;
}
