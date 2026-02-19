# jellyfish-ai

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

## Project Structure

```text
jellyfish-ai/
├── src/
│   ├── index.ts
│   ├── bot.ts
│   ├── agent.ts
│   ├── session.ts
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
npm install
```

2. Copy env file and fill values:

```bash
cp .env.example .env
```

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
npm run dev
```

6. Build:

```bash
npm run build
```

7. Run production build:

```bash
npm run start
```

## Notes

- The bot uses long polling (`bot.start()`).
- Replies stream into Telegram by editing a draft message as chunks arrive.
- Agent tools run with `permissionMode: "bypassPermissions"` in `src/agent.ts`.
