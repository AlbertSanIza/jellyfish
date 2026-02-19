# jellyfish-ai

Requires Bun 1.0+.

Personal Telegram AI bot built with `grammy` and the Claude Agent SDK.

## Features

- Telegram bot with allowlist access control via `ALLOWED_CHAT_IDS`
- Claude Agent SDK integration with streaming replies
- Session memory per chat saved to `~/.jellyfish/sessions/<chatId>.json`
- Custom memory tools:
    - `memory_read` from `~/.jellyfish/memory/<name>.md`
    - `memory_write` to `~/.jellyfish/memory/<name>.md`
- Commands:
    - `/new` clears chat session
    - `/status` shows stored message count
    - `/cron list` lists cron jobs for the current chat
    - `/cron add <schedule> <prompt>` adds a cron job
    - `/cron remove <id>` removes a cron job

## Project Structure

```text
jellyfish-ai/
├── src/
│   ├── index.ts
│   ├── bot.ts
│   ├── agent.ts
│   ├── session.ts
│   ├── cron.ts
│   └── tools.ts
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

## Setup

1. Install dependencies:

```bash
bun install
```

2. Copy env file and fill values:

```bash
cp .env.example .env
```

Bun loads `.env` automatically.

3. Configure authentication (choose one):

Option A - Claude.ai subscription (recommended for personal use):

```bash
claude login
```

That is it. The Claude Agent SDK uses the `claude` CLI binary, which picks up the OAuth session automatically.

Option B - Anthropic API key:

Set `ANTHROPIC_API_KEY` in your `.env` file.

4. Ensure required env values are set:

- `BOT_TOKEN`: Telegram bot token
- `ALLOWED_CHAT_IDS`: Comma-separated Telegram chat IDs allowed to use the bot

5. Run in development:

```bash
bun dev
```

6. Run normally:

```bash
bun start
```

## Running as a Daemon (pm2)

Start as a background daemon directly from TypeScript with Bun (no build step):

```bash
bun run daemon:start
```

Other commands:

- `bun run daemon:stop` - stop the daemon
- `bun run daemon:restart` - restart after code changes
- `bun run daemon:status` - check if running
- `bun run daemon:logs` - tail logs
- `bun run daemon:save` - persist across reboots (run once after start)

To auto-start on login (macOS):

```bash
pm2 startup
bun run daemon:save
```

## Cron Jobs

Cron jobs are managed from Telegram with `/cron` commands and persisted at `~/.jellyfish/crons.json`.

Examples:

```text
/cron list
/cron add "0 9 * * *" Give me a morning weather summary
/cron remove <id>
```

For local development/testing cron execution, run the bot with:

```bash
bun dev
```

## Notes

- The bot uses long polling (`bot.start()`).
- Replies stream into Telegram by editing a draft message as chunks arrive.
- Agent tools run with `permissionMode: "bypassPermissions"` in `src/agent.ts`.
