/**
 * 从仓库根目录加载 .env（§2.1）。已在进程环境中设置的变量优先。
 * 入口文件（index.ts、scripts/*）第一行 import 本文件即可。
 */
import path from "node:path";
import { config } from "dotenv";

export const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

config({ path: path.join(REPO_ROOT, ".env"), quiet: true });
