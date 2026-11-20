/** 应用版本的唯一来源：仓库根 package.json 的 version（/healthz、MCP serverInfo 共用）。 */
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./env.ts";

export const APP_VERSION: string = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")).version;
