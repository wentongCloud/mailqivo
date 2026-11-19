UPDATE "contacts"
SET "status" = 'unsubscribed'
WHERE "unsubscribed_at" IS NOT NULL AND "status" <> 'unsubscribed';
