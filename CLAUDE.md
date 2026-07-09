# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

im-coding bridges IM messages to coding agents. Current main chain: Feishu DM -> lark-cli event consume -> im-coding -> Codex -> Feishu reply.

## Commands

```bash
npm test              # Run all tests (node --test)
npm start             # Start bridge server
npm run server        # Same as start
npm run feishu:events # Run only Feishu event consumer (for when bridge is already running)
npm run dev:feishu    # Start bridge + Feishu event consumer together
```

Env setup: `cp .env.example .env`, fill Feishu credentials and Codex driver config, do not commit `.env`.

Mock inbound for quick testing:
```bash
curl -s http://127.0.0.1:4399/internal/mock/feishu/inbound \
  -H 'content-type: application/json' \
  -d '{"chatId":"chat_1","senderId":"user_1","text":"/projects"}'
```

## Architecture

ESM modules, Node.js 20+, zero external dependencies beyond Node built-ins and `sqlite3` CLI.

### Layered structure

```
src/
  cli.js              Entry point: commands are server | feishu-events | dev | init-env
  server.js           HTTP server, route dispatch, error boundary
  router.js           Command routing (slash commands + prompt forwarding to coding tool)
  config.js           Env parsing, dotenv loader, config shape
  store.js            SQLite persistence via sqlite3 CLI (spawnSync), WAL mode
  hook-handler.js     Receives Codex webhook callbacks, maps to threads, sends replies
  adapters/           IM platform adapters (feishu, feishu-consumed-event, feishu-event-consumer)
  codex/              Coding tool driver abstraction (driver.js, app-server-client.js, transcript-reader.js)
  lib/                Shared utils: http helpers, id generation, text splitting/command parsing
```

### Adapter pattern for IM platforms

Each IM platform has an adapter that normalizes inbound events to a common shape (`adapter`, `externalEventId`, `externalMessageId`, `chatId`, `senderId`, `text`, `chatType`) and provides `sendText({ chatId, text })` for outbound. Currently only Feishu is implemented. New IM platforms follow the same shape.

### Coding tool driver abstraction

`src/codex/driver.js` exports a factory `createCodexDriver({ config, logger })` returning an object with:
- `createThread({ projectId, projectPath, threadId, title })` -> `{ externalThreadId, sessionId }`
- `sendMessage({ projectId, projectPath, threadId, externalThreadId, content, runId })` -> `{ sessionId, turnId?, runId? }`
- `cancelRun({ threadId, externalThreadId, runId })` -> `{ cancelled, reason? }`
- `close()` for cleanup

Three built-in drivers: `stub` (no-op), `cli` (one-shot `codex exec`), `app-server` (long-lived Codex app-server thread/turn). Drivers self-notify results back via `POST /codex/hooks` — the bridge never polls.

### Storage

`SqliteStore` uses `spawnSync` against the `sqlite3` CLI binary, not a Node driver. Tables: `users`, `im_bindings`, `projects`, `threads`, `chat_contexts`, `messages`, `events`, `runs`, `outbound_messages`. `coding_tool` column on projects already exists for future multi-tool support. No migration system yet.

### Request flow

1. Inbound IM event arrives via webhook or internal mock endpoint
2. Event is deduplicated and stored in `events` table
3. `CommandRouter.routeInbound()` parses slash commands or forwards text to `codexDriver.sendMessage()`
4. Driver executes asynchronously and calls back `POST /codex/hooks` when done
5. `CodexHookHandler` maps the callback to a thread and sends the reply through the IM adapter

### Config

All config comes from `.env` / process env. `loadConfig()` in `config.js` builds the full config object. Key sections: `server`, `store`, `feishu`, `codex`, `projects`, `access`. Multi-project via `IM_CODING_PROJECTS_JSON`. Path values with `~/` are expanded to the home directory.

## Extension points

- **New IM platform**: add adapter in `src/adapters/`, wire into `ImCodingServer` constructor, add inbound route in `server.js`
- **New coding tool**: implement the driver interface (`createThread`, `sendMessage`, `cancelRun`, `close`) and register in `createCodexDriver()`
- **New slash commands**: add case in `CommandRouter.routeCommand()`
- **New HTTP endpoints**: add route handler in `ImCodingServer.handle()`
