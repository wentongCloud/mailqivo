import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { apiOrigin, readDemoSettings, webOrigin } from "./config.mjs";

const installing = process.argv[2] === "--install";
const settings = installing
  ? parseEnv(readFileSync(new URL("../.env", import.meta.url), "utf8"))
  : readDemoSettings();
const api = installing ? settings.SERVER_INTERNAL_URL : apiOrigin;
const web = installing ? settings.PUBLIC_BASE_URL : webOrigin;
assert.ok(/^http:\/\/127\.0\.0\.1:\d+$/.test(api ?? ""), "The starter data requires a local Mailqivo API.");
const company = "Example Workshop";
const audienceTag = "Workshop demo";
const campaignName = "Demo: Fall workshop invitation";
const contact = { email: "avery@example.com", name: "Avery Example", company: "Example Fieldworks" };
const signature = {
  name: "Example Workshop Signature",
  html: "<p>Best regards,<br>Example Workshop Team<br>workshops@example.com</p>",
  is_default: false
};
const localMailServer = { host: "127.0.0.1", port: 1, secure: false, user: "", pass: "" };
const channel = {
  name: "Demo only",
  smtp: localMailServer,
  imap: localMailServer,
  from_email: "workshops@example.com",
  from_name: company,
  reply_to: "workshops@example.com",
  rate_per_minute: 5,
  daily_limit: 20,
  is_default: false
};
let cookie;

async function request(method, path, body) {
  const headers = new Headers();
  if (body !== undefined) headers.set("Content-Type", "application/json");
  if (cookie) headers.set("Cookie", cookie);
  const response = await fetch(new URL(path, api), {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`${method} ${path.replace(/\/[^/]+\/preview$/, "/:id/preview")} returned HTTP ${response.status}.`);
  if (path === "/api/auth/login") cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  return await response.json();
}

await request("POST", "/api/auth/login", { password: settings.ADMIN_PASSWORD });
assert.ok(cookie, "Demo login did not set a session cookie.");
const [knownContacts, knownChannels, knownCampaigns, knownSignatures] = await Promise.all([
  request("GET", "/api/contacts/?statuses=&page_size=200"),
  request("GET", "/api/channels/"),
  request("GET", "/api/campaigns/?page_size=200"),
  request("GET", "/api/signatures/")
]);
if (knownContacts.total !== knownContacts.items.length ||
    knownContacts.items.length > 1 ||
    knownContacts.items.some(({ email }) => email !== contact.email) ||
    knownChannels.items.length > 1 ||
    knownSignatures.items.length > 1 ||
    knownSignatures.items.some(({ name }) => name !== signature.name) ||
    knownChannels.items.some(({ name, smtp, imap }) => name !== channel.name ||
      [smtp, imap].some(({ host, port, user }) => host !== "127.0.0.1" || port !== 1 || user !== "")) ||
    knownCampaigns.total !== knownCampaigns.items.length ||
    knownCampaigns.items.length > 1 ||
    knownCampaigns.items.some(({ name, status }) => name !== campaignName || status !== "draft")) {
  if (installing) {
    console.log("Starter data skipped because the workspace contains other records.");
    process.exit(0);
  }
  throw new Error("The target already contains records outside this demo. Use an empty demo database.");
}

if (!installing) await request("PATCH", "/api/settings/", {
  company_name: company,
  company_address: "100 Example Lane, Sample City",
  unsubscribe_page_text: "Confirm to stop receiving Example Workshop emails.",
  sensitive_words: ["guaranteed results"],
  prepare_warn_recipient_threshold: 25,
  attachment_max_total_mb: 5
});

const mailChannel = knownChannels.items[0] ?? await request("POST", "/api/channels/", channel);
const savedSignature = knownSignatures.items[0] ?? await request("POST", "/api/signatures/", signature);
const savedContact = knownContacts.items[0] ?? await request("POST", "/api/contacts/", { ...contact, tags: [audienceTag] });
if (installing && savedContact.status === "active") {
  const change = { contact_ids: [savedContact.id], status: "invalid", reason: "Sample contact — preview only" };
  const challenge = await request("POST", "/api/contacts/status", change);
  const result = await request("POST", "/api/contacts/status", { ...change, confirm_token: challenge.confirm_token });
  assert.equal(result.updated, 1, "The sample contact must be excluded from real sending.");
}

const campaign = knownCampaigns.items[0] ?? await request("POST", "/api/campaigns/", {
  name: campaignName,
  subject: "A workshop invitation for {{name}}",
  html: "<p>Hi {{name}},</p><p>We would love to see the team at {{company}} at our fall workshop. Join us for a short presentation and a hands-on session.</p><p><a href=\"https://example.com/workshops\">View the workshop agenda</a></p>",
  channel_id: mailChannel.id,
  signature_id: savedSignature.id,
  contact_filter: { tags_any: [audienceTag], statuses: ["active"], exclude_domain_suspect: false },
  track_opens: false,
  track_clicks: false
});
const previews = await request("POST", `/api/campaigns/${campaign.id}/preview`, { contact_ids: [savedContact.id] });
assert.equal(previews.length, 1);
assert.ok(
  previews[0].contact.email === contact.email && previews[0].subject.includes(contact.name) &&
    previews[0].html.includes(contact.company) && previews[0].html.includes("Example Workshop Team"),
  "The sample preview must resolve its contact and include the sample signature."
);
const messages = await request("GET", `/api/campaigns/${campaign.id}/messages`);
assert.equal(messages.total, 0, "The demo campaign must contain zero queued or sent messages.");
console.log("Loaded one channel, signature, draft, and contact. Verified personalized preview. Message records: 0.");
console.log(`Settings: ${web}/settings/compliance`);
console.log(`Channels: ${web}/settings/channels`);
console.log(`Campaign editor: ${web}/campaigns/${campaign.id}/edit`);
console.log(`Signatures: ${web}/settings/signatures`);
