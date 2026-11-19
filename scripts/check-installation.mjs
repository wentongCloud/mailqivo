import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const hero = "apps/web/public/images/extra/image4.jpg";
assert.ok(statSync(new URL(hero, root)).size > 0, "Login image is missing or empty");
assert.equal(readFileSync(new URL(hero, root)).readUInt16BE(), 0xffd8, "Login image must be JPEG");
assert.ok(read("scripts/install-codex.sh").includes(hero), "Installer must require the login image");
assert.ok(read("apps/web/lib/api/client.ts").includes("redirectExpiredSession(path, res.status)"), "Expired sessions must return to login");
assert.ok(read("scripts/service/start-server.sh").includes("unset MCP_TOKEN"), "Server must load its token from .env");
assert.ok(read("apps/server/src/mcp/workspace.ts").includes('statuses: ["active", "invalid", "bounced", "unsubscribed"]'), "Workspace must show preview-only contacts");
console.log("Installation package checks passed.");
