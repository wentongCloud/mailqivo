# Unsubscribe demo and self-hosting

The hosted WentongCloud unsubscribe service is for WentongCloud's own email campaigns. To offer unsubscribe links from your Mailqivo installation, deploy the built-in unsubscribe endpoint on a domain you control.

## Try the local demo

1. Set up and start the [isolated sample workspace](../demo/README.md), then run its seed command.
2. Run `node demo/unsubscribe.mjs` from the repository root. Open the printed local URL.
3. Review the confirmation page and select the unsubscribe button. In the demo console, open **People** and check that **Demo Recipient** is unsubscribed.

The script creates a fictional contact and a synthetic message record in the demo database. No email is sent. For an automated check, run `node demo/unsubscribe.mjs --verify`. Use a fresh demo checkout to rerun the original campaign seed after adding unsubscribe fixtures.

## Deploy the built-in endpoint

1. Run the Mailqivo API against the PostgreSQL database used by your sending workers. Keep the API port private.
2. Add a public HTTPS virtual host for your own domain. Route public GET and POST requests under `/u/` to the corresponding path on the API. Keep the administration console, MCP, and other API routes private.
3. Set `MAIL_PUBLIC_BASE_URL` in your private Mailqivo environment to the public HTTPS origin. For this deployment, leave `UNSUBSCRIBE_PUBLIC_URL` and `UNSUBSCRIBE_SHARED_SECRET` empty. Restart the API and workers so they load the change.
4. Include `{{sys.unsubscribe_url}}` in your message template. When a campaign generates recipient messages, Mailqivo uses the configured HTTPS origin and the recipient's message identifier to build the link.

This Nginx location belongs inside your TLS-enabled virtual host. Replace the upstream address if your private API runs elsewhere.

```nginx
location ^~ /u/ {
    access_log off;
    proxy_pass http://127.0.0.1:18091;
    proxy_set_header Host $host;
}
```

On a staging installation, verify that a recipient link opens the confirmation page. Opening it should leave the contact active. Confirming it should mark the contact as unsubscribed and exclude that contact from future sends. Verify one-click POST handling with `List-Unsubscribe=One-Click` on a separate staging recipient. Keep the HTTPS endpoint and its message records available for links already sent.
