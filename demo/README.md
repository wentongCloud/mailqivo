# Run the Mailqivo demo

Extract the release archive into a new directory or make a fresh checkout. Use the demo only in that copy. It uses a separate database with fictional contacts and generated local credentials.

From the repository root, run:

```sh
pnpm install --frozen-lockfile
node demo/prepare.mjs
pnpm --filter @mailqivo/server typecheck
pnpm --filter @mailqivo/web exec next build --webpack
node demo/run.mjs
```

Keep the services running. In a second terminal, from the same directory, run:

```sh
node demo/seed.mjs
```

Open [the demo console](http://127.0.0.1:19490/login). Find the generated `ADMIN_PASSWORD` in the local `.env` using a text editor and use it to sign in. The seed command verifies personalized previews for one fictional contact and prints the settings and campaign editor links. The seed loads one English sample in each category. The disconnected channel contains both SMTP and IMAP settings. The campaign uses the example signature and contact. The editor shows the template. The seed command verifies the resolved subject and body through the same preview API that Mailqivo uses.

The demo binds to loopback ports 19490 (web), 19491 (API), and 19492 (database). It uses built-in mock AI, runs no delivery or inbox workers, and stores the example mail settings with empty credentials and loopback-only endpoints. Leave Send, Test Send, and connection tests unused. Stop the services with Ctrl+C. Runtime files (`.env`, `.pgdata/`, and `.demo-assets/`) belong only to the local checkout.
