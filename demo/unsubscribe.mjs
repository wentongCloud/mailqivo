import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readDemoSettings, webOrigin } from "./config.mjs";

const { DATABASE_URL } = readDemoSettings();
const require = createRequire(new URL("../apps/server/package.json", import.meta.url));
const { Client } = require("pg");
const db = new Client({ connectionString: DATABASE_URL });
async function createRecipient(campaignId) {
  const trackingId = randomUUID();
  const contactId = randomUUID();
  await db.query("BEGIN");
  try {
    await db.query("INSERT INTO contacts (id, email, name, source) VALUES ($1, $2, $3, 'manual')",
      [contactId, `unsubscribe-${contactId}@example.com`, "Demo Recipient"]);
    await db.query(
      "INSERT INTO messages (tracking_id, campaign_id, contact_id, email, status) SELECT $1, $2, id, email, 'sent' FROM contacts WHERE id = $3",
      [trackingId, campaignId, contactId]
    );
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }

  return { contactId, url: new URL(`/u/${trackingId}`, webOrigin) };
}

async function contactStatus(contactId) {
  const result = await db.query("SELECT status FROM contacts WHERE id = $1", [contactId]);
  return result.rows[0].status;
}

await db.connect();
try {
  const campaign = await db.query(
    "SELECT id FROM campaigns WHERE name = $1 AND status = 'draft'",
    ["Demo: Fall workshop invitation"]
  );
  assert.equal(campaign.rowCount, 1, "Run the sample workspace and its seed command first.");
  const campaignId = campaign.rows[0].id;
  const { contactId, url } = await createRecipient(campaignId);

  if (process.argv.includes("--verify")) {
    const page = await fetch(url);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<form method="post">/);
    assert.equal(await contactStatus(contactId), "active");
    const confirm = await fetch(url, { method: "POST" });
    assert.equal(confirm.status, 200);
    assert.equal(await contactStatus(contactId), "unsubscribed");
    const repeated = await fetch(url, { method: "POST" });
    assert.equal(repeated.status, 200);
    assert.equal(await contactStatus(contactId), "unsubscribed");

    const secondRecipient = await createRecipient(campaignId);
    assert.equal(await contactStatus(secondRecipient.contactId), "active");
    const oneClick = await fetch(secondRecipient.url, {
      method: "POST",
      body: new URLSearchParams({ "List-Unsubscribe": "One-Click" })
    });
    assert.equal(oneClick.status, 200);
    assert.equal(await oneClick.text(), "");
    assert.equal(await contactStatus(secondRecipient.contactId), "unsubscribed");
    console.log("Verified browser confirmation, one-click handling, and repeat submission.");
  } else {
    console.log(`Open this local confirmation page: ${url}`);
    console.log("The demo uses a synthetic message record. It sends no email.");
  }
} finally {
  await db.end();
}
