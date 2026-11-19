import "./env.ts";
import { ConfigError, loadConfig, type Config } from "./config.ts";
import { buildApp } from "./app.ts";
import { createDb } from "./db/client.ts";
import { AssetDirError, prepareAssetDir } from "./modules/assets/storage.ts";
import { runsApi, runsBackgroundWorkers, startBackgroundServices, type BackgroundHandle } from "./roles.ts";

let config: Config;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}

// V1.1：api / all 创建 ASSET_DIR；worker / all 要求其可读，否则拒绝启动。
try {
  await prepareAssetDir(config);
} catch (err) {
  if (err instanceof AssetDirError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}

// ROLE=all|api|worker：API 与后台队列可使用同一进程，也可独立部署。
let background: BackgroundHandle | null = null;
let workerDb: ReturnType<typeof createDb> | undefined;
if (runsBackgroundWorkers(config.ROLE)) {
  workerDb = createDb(config.DATABASE_URL);
  background = startBackgroundServices(config, workerDb.db);
}
const shutdownWorkers = async () => {
  await background?.stop();
  await workerDb?.close();
};
if (runsApi(config.ROLE)) {
  const app = await buildApp({ config, logger: { level: "info" } });
  const shutdown = async () => {
    await app.close();
    await shutdownWorkers();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  await app.listen({ port: config.SERVER_PORT, host: config.SERVER_HOST });
} else {
  console.log("发送 worker 与 scheduler 已启动");
  process.on("SIGINT", () => { void shutdownWorkers().then(() => process.exit(0)); });
  process.on("SIGTERM", () => { void shutdownWorkers().then(() => process.exit(0)); });
}
