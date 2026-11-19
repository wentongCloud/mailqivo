import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { readDemoSettings, root } from "./config.mjs";

const settings = readDemoSettings();
const apiOnly = process.argv.includes("--api-only");
const children = [];
const childSettings = { PATH: process.env.PATH, HOME: process.env.HOME, ...settings, NEXT_TELEMETRY_DISABLED: "1" };

function pnpm(args, pipeOutput = false) {
  const child = spawn("pnpm", args, {
    cwd: root,
    env: childSettings,
    stdio: ["ignore", pipeOutput ? "pipe" : "inherit", "inherit"]
  });
  children.push(child);
  return child;
}

function stop() {
  for (const child of children.toReversed()) child.kill("SIGTERM");
}

async function assertPortAvailable(port) {
  const socket = createServer();
  socket.listen(port, "127.0.0.1");
  await once(socket, "listening");
  socket.close();
  await once(socket, "close");
}

function waitForDatabase(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    const deadline = setTimeout(() => reject(new Error("The demo database did not start.")), 30_000);
    child.once("error", reject);
    child.once("exit", () => reject(new Error("The demo database stopped during startup.")));
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      output = (output + chunk).slice(-4096);
      if (output.includes("PostgreSQL 16 已启动")) {
        clearTimeout(deadline);
        resolve();
      }
    });
    child.once("exit", () => clearTimeout(deadline));
    child.once("error", () => clearTimeout(deadline));
  });
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
try {
  await Promise.all([19491, 19492, ...(apiOnly ? [] : [19490])].map(assertPortAvailable));
  const database = pnpm(["db:start"], true);
  await waitForDatabase(database);
  const [migrationExit] = await once(pnpm(["db:migrate"]), "exit");
  if (migrationExit !== 0) throw new Error("Demo database migration failed.");

  const services = [database, pnpm(["--filter", "@mailqivo/server", "start"])];
  if (!apiOnly) services.push(pnpm(["--filter", "@mailqivo/web", "exec", "next", "start", "-H", "127.0.0.1", "-p", "19490"]));
  const [serviceExit] = await Promise.race(services.map((service) => once(service, "exit")));
  process.exitCode = serviceExit ?? 0;
} finally {
  stop();
}
