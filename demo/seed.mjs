import assert from "node:assert/strict";
import { apiOrigin, readDemoSettings, webOrigin } from "./config.mjs";

const { ADMIN_PASSWORD } = readDemoSettings();
const company = "Example Workshop";
const audienceTag = "Workshop demo";
const campaignName = "Demo: Fall workshop invitation";
const contacts = [
  { email: "avery@example.com", name: "Avery Example", company: "Example Fieldworks" },
  { email: "morgan@example.com", name: "Morgan Example", company: "Example Studio" }
];
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
  is_default: true
};
let cookie;

async function request(method, path, body) {
  const headers = new Headers();
  if (body !== undefined) headers.set("Content-Type", "application/json");
  if (cookie) headers.set("Cookie", cookie);
  const response = await fetch(new URL(path, apiOrigin), {
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

await request("POST", "/api/auth/login", { password: ADMIN_PASSWORD });
assert.ok(cookie, "Demo login did not set a session cookie.");
const [knownContacts, knownChannels, knownCampaigns] = await Promise.all([
  request("GET", "/api/contacts/?page_size=200"),
  request("GET", "/api/channels/"),
  request("GET", "/api/campaigns/?page_size=200")
]);
if (knownContacts.total !== knownContacts.items.length ||
    knownContacts.items.some(({ email }) => !contacts.some((contact) => contact.email === email)) ||
    knownChannels.items.some(({ name, smtp, imap }) => name !== channel.name ||
      [smtp, imap].some(({ host, port, user }) => host !== "127.0.0.1" || port !== 1 || user !== "")) ||
    knownCampaigns.total !== knownCampaigns.items.length ||
    knownCampaigns.items.some(({ name, status }) => name !== campaignName || status !== "draft")) {
  throw new Error("The target already contains records outside this demo. Use an empty demo database.");
}

await request("PATCH", "/api/settings/", {
  company_name: company,
  company_address: "100 Example Lane, Sample City",
  unsubscribe_page_text: "Confirm to stop receiving Example Workshop emails.",
  sensitive_words: ["guaranteed results"],
  prepare_warn_recipient_threshold: 25,
  attachment_max_total_mb: 5
});

const mailChannel = knownChannels.items[0] ?? await request("POST", "/api/channels/", channel);
const contactIds = [];
for (const contact of contacts) {
  const existing = knownContacts.items.find(({ email }) => email === contact.email);
  const saved = existing ?? await request("POST", "/api/contacts/", { ...contact, tags: [audienceTag] });
  contactIds.push(saved.id);
}

const campaign = knownCampaigns.items[0] ?? await request("POST", "/api/campaigns/", {
  name: campaignName,
  subject: "A workshop invitation for {{name}}",
  html: "<p>Hi {{name}},</p><p>We would love to see the team at {{company}} at our fall workshop. Join us for a short presentation and a hands-on session.</p><p><a href=\"https://example.com/workshops\">View the workshop agenda</a></p>",
  channel_id: mailChannel.id,
  contact_filter: { tags_all: [audienceTag], statuses: ["active"], exclude_domain_suspect: false },
  track_opens: false,
  track_clicks: false
});
const previews = await request("POST", `/api/campaigns/${campaign.id}/preview`, { contact_ids: contactIds });
assert.equal(previews.length, contacts.length);
for (const [index, contact] of contacts.entries()) {
  assert.ok(
    previews[index].contact.email === contact.email && previews[index].subject.includes(contact.name) &&
      previews[index].html.includes(contact.company),
    "A preview did not resolve its contact variables."
  );
}
const messages = await request("GET", `/api/campaigns/${campaign.id}/messages`);
assert.equal(messages.total, 0, "The demo campaign must contain zero queued or sent messages.");
console.log("Demo loaded and personalized previews verified for two contacts. Message records: 0.");
console.log(`Settings: ${webOrigin}/settings/compliance`);
console.log(`Channels: ${webOrigin}/settings/channels`);
console.log(`Campaign editor: ${webOrigin}/campaigns/${campaign.id}/edit`);
