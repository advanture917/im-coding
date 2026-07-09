# im-coding

把 IM 消息桥接到 coding agent。

当前主链路：

```text
飞书私聊消息 -> lark-cli event consume -> im-coding -> Codex -> 飞书回复
```

## 状态

已实现：本地 HTTP Bridge、SQLite 存储、飞书/Lark 私聊文本入站、飞书文本回复、项目/会话指令、Codex hook 接收，以及 Codex `stub` / `cli` / `app-server` 三种 driver。

未实现：飞书之外的 IM、Codex 之外的 coding tool、群聊、附件、富文本、加密 webhook payload、生产级队列/重试/迁移、管理界面。

详情见 [docs/current-status-and-roadmap.md](docs/current-status-and-roadmap.md)。

## 环境要求

- Node.js 20+
- 本机可用的 `sqlite3`
- 飞书入站需要 `lark-cli` 和飞书/Lark 应用
- Codex 运行需要 Codex 桌面端/CLI

飞书私聊开发需要权限 `im:message.p2p_msg:readonly`、事件 `im.message.receive_v1`、机器人发送消息权限。

## 快速开始

```bash
npm test
npm start
curl http://127.0.0.1:4399/health
```

模拟入站消息：

```bash
curl -s http://127.0.0.1:4399/internal/mock/feishu/inbound \
  -H 'content-type: application/json' \
  -d '{"chatId":"chat_1","senderId":"user_1","text":"/projects"}'
```

## 飞书本地开发

```bash
cp .env.example .env
npm run dev:feishu
```

在 `.env` 填飞书凭据。

`npm run dev:feishu` 会启动 Bridge、`lark-cli event consume im.message.receive_v1 --as bot`，并转发事件到 `POST /internal/feishu/events`。

Bridge 已启动时只跑事件消费者：

```bash
npm run feishu:events
```

用 `IM_CODING_BRIDGE_URL=http://127.0.0.1:4399` 覆盖 Bridge 地址。

## Codex Driver

在 `.env` 设置：

```env
IM_CODING_CODEX_DRIVER=app-server
```

可选值：

- `stub`：只验证路由，不启动 Codex。
- `cli`：一次性执行 `codex exec`。
- `app-server`：创建 Codex app-server thread 和 turn。

`app-server` 依赖 Codex experimental API，协议变化时 driver 可能要同步更新。

## 飞书指令

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

非指令文本会发送到当前项目和会话。

## 配置

改 `.env` 里需要的项。

常用变量：

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

多项目用 `IM_CODING_PROJECTS_JSON`。

## HTTP 接口

- `GET /health`
- `GET /internal/outbound`
- `POST /webhooks/feishu/events`
- `POST /internal/feishu/events`
- `POST /internal/mock/feishu/inbound`
- `POST /internal/feishu/send`
- `POST /codex/hooks`

## 文档

- [README.md](README.md)
- [docs/im-coding-requirements.md](docs/im-coding-requirements.md)
- [docs/current-status-and-roadmap.md](docs/current-status-and-roadmap.md)
- [docs/spec/spec-001-feishu-codex-mvp.md](docs/spec/spec-001-feishu-codex-mvp.md)
- [docs/spec/spec-002-feishu-inbound-dev-mode.md](docs/spec/spec-002-feishu-inbound-dev-mode.md)
