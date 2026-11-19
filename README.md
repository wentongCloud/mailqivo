# Mailqivo

Mailqivo is a local Codex plugin for drafting personalized email campaigns, reviewing recipient-specific previews, and following campaign results and replies.

- [Product design](guide/product-design.md)
- [Browser user guide](https://wentongcloud.github.io/mailqivo/guide/index.html)
- [Sample workspace](demo/README.md)
- [Unsubscribe demo and self-hosting](guide/unsubscribe.md)
- [Website](https://docsintel.com)

## Install on macOS

Install and open the Codex desktop app. Install Node.js 22.13+ (22.x) or 24+ and pnpm 11. The initial build downloads dependencies and fonts. Use a machine without an existing Mailqivo local marketplace or services when installing from a fresh checkout.

Download and extract the [current Mailqivo source ZIP](https://github.com/wentongCloud/mailqivo/archive/refs/heads/main.zip), then run this command in the extracted directory.

```sh
zsh scripts/install-codex.sh
```

The installer starts the local database, API, and web console. It registers the local marketplace and installs Mailqivo in Codex. A new database starts with one English sample sending and receiving channel, signature, campaign draft, and contact. The sample channel is disconnected and the sample contact is excluded from sending. Keep the extracted directory in place while the services are registered.

Open Mailqivo from Codex. The administration console runs at [http://127.0.0.1:18090](http://127.0.0.1:18090). To sign in, open the `.env` file at the path printed by the installer and copy the value after `ADMIN_PASSWORD=`. Retrying the installation in the same directory preserves this password. Keep the populated `.env` private.

To try the starter draft, ask Mailqivo in Codex to preview **Demo: Fall workshop invitation** for **avery@example.com**. You can also run the [isolated sample workspace](demo/README.md). Before using a real mailing list, configure your own sending channel and sender identity, review consent and unsubscribe settings, and inspect a personalized preview.

## Uninstall on macOS

```sh
zsh scripts/uninstall-codex.sh
```

Read the uninstall prompts before choosing whether to remove local data.

## License

Mailqivo is distributed under the [Community & Commercial Dual License](LICENSE). Review its eligibility and commercial licensing terms before use or redistribution.

Maintained by wentong cloud.
