import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
for (const path of [".env", ".pgdata", ".demo-assets"]) {
  if (existsSync(new URL(path, root))) {
    throw new Error("Use a fresh checkout or an extracted release archive for the demo.");
  }
}

const hex = () => randomBytes(32).toString("hex");
const settings = {
  DATABASE_URL: `postgresql://mailqivo_demo:${hex()}@127.0.0.1:19492/mailqivo_demo`,
  PUBLIC_BASE_URL: "http://127.0.0.1:19490",
  MAIL_ID_DOMAIN: "example.com",
  APP_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  ADMIN_PASSWORD: hex(),
  SESSION_SECRET: hex(),
  MCP_TOKEN: hex(),
  ASSET_DIR: ".demo-assets",
  APP_TIMEZONE: "UTC",
  ROLE: "api",
  SERVER_HOST: "127.0.0.1",
  SERVER_PORT: "19491",
  SERVER_INTERNAL_URL: "http://127.0.0.1:19491",
  LLM_MOCK: "1"
};
const values = Object.entries(settings).map(([key, value]) => `${key}=${value}`);
writeFileSync(new URL(".env", root), `# Mailqivo isolated demo\n${values.join("\n")}\n`, {
  flag: "wx",
  mode: 0o600
});
console.log("Created private demo settings for web 19490, API 19491, and database 19492.");
