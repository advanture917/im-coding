# im-coding

`im-coding` bridges Feishu private messages to a local Codex workflow.

This repository currently implements Spec 001 MVP:

- Bridge HTTP server
- SQLite state store
- Feishu private text webhook adapter
- Command router
- Local mock inbound endpoint
- Codex hook receiver
- Stub and experimental CLI Codex drivers

## Quick Start

```bash
npm test
npm start
```

Health check:

```bash
curl http://127.0.0.1:4399/health
```

Mock a Feishu message locally:

```bash
curl -s http://127.0.0.1:4399/internal/mock/feishu/inbound \
  -H 'content-type: application/json' \
  -d '{"chatId":"chat_1","senderId":"user_1","text":"/projects"}'
```

## Configuration

Project-local environment variables are loaded from `.env` before `~/.im-coding/config.yaml`.
Use `.env.example` as the template; keep the real `.env` out of version control.

Create a default config:

```bash
node src/cli.js init-config
```

The server reads `~/.im-coding/config.yaml` by default. Override with:

```bash
IM_CODING_CONFIG=/path/to/config.yaml npm start
```

The default Codex driver is `stub`, which lets you validate Feishu routing and hook callback handling without launching Codex. To try the non-interactive CLI spike:

```yaml
codex:
  driver: cli
```

## Endpoints

- `GET /health`
- `POST /webhooks/feishu/events`
- `POST /internal/mock/feishu/inbound`
- `POST /internal/feishu/send`
- `POST /codex/hooks`
- `GET /internal/outbound`
