# im-coding

Bridge IM messages to coding agents.

Current loop:

```text
Feishu private message -> lark-cli event consume -> im-coding -> Codex -> Feishu reply
```

## Status

Implemented: local HTTP Bridge, SQLite store, Feishu/Lark private text inbound, Feishu text replies, project/thread commands, Codex hook receiver, and Codex `stub` / `cli` / `app-server` drivers.

Not implemented: non-Feishu IM adapters, non-Codex coding tools, group chats, attachments, rich messages, encrypted webhook payloads, production queues/retries/migrations, and admin UI.

Details: [docs/current-status-and-roadmap.md](docs/current-status-and-roadmap.md).

## Requirements

- Node.js 20+
- `sqlite3` in `PATH`
- `lark-cli` and a Feishu/Lark app for real inbound messages
- Codex desktop/CLI for real Codex runs

Feishu private-message development requires `im:message.p2p_msg:readonly`, event `im.message.receive_v1`, and bot send-message permission.

## Quick Start

```bash
npm test
npm start
curl http://127.0.0.1:4399/health
```

Mock inbound message:

```bash
curl -s http://127.0.0.1:4399/internal/mock/feishu/inbound \
  -H 'content-type: application/json' \
  -d '{"chatId":"chat_1","senderId":"user_1","text":"/projects"}'
```

## Feishu Local Development

```bash
cp .env.example .env
npm run dev:feishu
```

Fill `.env` with Feishu credentials and do not commit it.

`npm run dev:feishu` starts the Bridge, `lark-cli event consume im.message.receive_v1 --as bot`, and the internal forwarder to `POST /internal/feishu/events`.

If the Bridge is already running:

```bash
npm run feishu:events
```

Override the Bridge URL with `IM_CODING_BRIDGE_URL=http://127.0.0.1:4399`.

## Codex Driver

Set `IM_CODING_CODEX_DRIVER` in `.env`:

```env
IM_CODING_CODEX_DRIVER=app-server
```

Supported values:

- `stub`: validate routing without launching Codex.
- `cli`: run one-off `codex exec` jobs.
- `app-server`: create real Codex app-server threads and turns.

`app-server` uses an experimental Codex API, so protocol changes may require driver updates.

## Feishu Commands

```text
/help
/status
/projects
/use <project>
/new [title]
/threads
/switch <thread>
/cancel
```

Any non-command text is sent to the current project/thread.

## Configuration

Configuration is env-only. Edit only what you need in `.env`.

Common variables:

```text
FEISHU_ENABLED=true
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=...
IM_CODING_CODEX_DRIVER=app-server
IM_CODING_CODEX_SANDBOX=workspace-write
IM_CODING_CODEX_APPROVAL=never
IM_CODING_PORT=4399
IM_CODING_STORE_PATH=~/.im-coding/im-coding.db
IM_CODING_PROJECT_ROOT=/absolute/path/to/project
IM_CODING_ALLOWED_FEISHU_USERS=ou_xxx,ou_yyy
IM_CODING_HOOK_TOKEN=...
CODEX_BIN=/Applications/Codex.app/Contents/Resources/codex
```

Use `IM_CODING_PROJECTS_JSON` for multiple projects.

## HTTP Endpoints

- `GET /health`
- `GET /internal/outbound`
- `POST /webhooks/feishu/events`
- `POST /internal/feishu/events`
- `POST /internal/mock/feishu/inbound`
- `POST /internal/feishu/send`
- `POST /codex/hooks`

## Docs

- [README_zh.md](README_zh.md)
- [docs/im-coding-requirements.md](docs/im-coding-requirements.md)
- [docs/current-status-and-roadmap.md](docs/current-status-and-roadmap.md)
- [docs/spec/spec-001-feishu-codex-mvp.md](docs/spec/spec-001-feishu-codex-mvp.md)
- [docs/spec/spec-002-feishu-inbound-dev-mode.md](docs/spec/spec-002-feishu-inbound-dev-mode.md)
