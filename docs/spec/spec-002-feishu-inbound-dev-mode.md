# Spec 002：飞书真实入站本地开发模式

版本：v0.1  
日期：2026-07-06  
状态：Draft  
关联规格：[Spec 001：飞书 + Codex 最小闭环](./spec-001-feishu-codex-mvp.md)

## 1. 背景

Spec 001 已经实现本地 Bridge、飞书发送、mock 入站、Hook 回流和 Codex Driver 抽象。当前真实状态是：

```text
Bridge -> Feishu 私聊消息：已跑通
Feishu 私聊消息 -> Bridge：未跑通
Bridge -> Codex：stub 默认可验证路由，cli 模式仍是实验路径
```

阻塞点不是飞书 App ID/Secret。当前凭据已经能用 bot 身份发送消息，也能列出 bot 所在会话。真正缺口是：飞书云端消息事件还没有进入本机 Bridge。

如果直接走传统 webhook，需要公网 HTTPS URL、飞书开发者后台事件订阅和本机 tunnel。这个路径适合生产化，但对当前本地开发闭环偏重。

本 spec 选择更合适的开发方式：用 `lark-cli event consume im.message.receive_v1 --as bot` 在本机消费飞书消息事件，再转发给本机 Bridge。

## 2. 目标

实现一个本地开发模式，让用户发给飞书 bot 的私聊文本可以进入当前项目的 Bridge：

```text
Feishu 私聊消息
  -> lark-cli event consume
  -> im-coding Event Consumer
  -> Bridge inbound router
  -> Codex Driver
  -> Feishu 状态回复
```

开发模式的核心目标：

- 不依赖公网 HTTPS。
- 不依赖 ngrok、cloudflared、反向代理或云端 relay。
- 复用当前 `.env` 中的飞书 App ID/Secret。
- 复用 Spec 001 已有的 `CommandRouter`、`FeishuAdapter`、SQLite 去重和 Codex Driver。
- 能用真实飞书私聊验证 `/help`、`/projects`、`/use`、`/new` 和普通任务消息。

## 3. 结论：推荐开发方式

### 3.1 推荐方案

Phase 1.5 采用：

```bash
lark-cli event consume im.message.receive_v1 --as bot
```

作为本地飞书入站事件源。

原因：

- 本机可运行，不需要飞书云端访问 `127.0.0.1`。
- 输出是 NDJSON，适合长期子进程消费。
- `im.message.receive_v1` schema 已经把消息事件压平，字段可直接映射到内部 `ImInboundEvent`。
- `content` 字段对文本消息已经是可读文本，不需要二次 `JSON.parse`。
- `event_id` 可直接用于幂等去重。

### 3.2 不优先采用的方案

#### 公网 webhook + tunnel

保留为生产路径或后续验收路径，不作为当前默认开发方式。

问题：

- 需要稳定公网 HTTPS URL。
- 需要处理飞书 URL verification、签名、重试、加密消息等更多边界。
- 本地开发经常因为 tunnel URL 变化反复改飞书后台配置。

#### 轮询聊天记录

不采用。

问题：

- 延迟高。
- 需要消息读取权限。
- 去重和游标更复杂。
- 不符合事件驱动模型。

#### 桌面端 UI 自动化

不采用。

问题：

- 脆弱。
- 不适合做稳定入站主链路。

## 4. 事件能力确认

当前 `lark-cli event schema im.message.receive_v1 --json` 的关键结果：

```json
{
  "key": "im.message.receive_v1",
  "scopes": ["im:message.p2p_msg:readonly"],
  "auth_types": ["bot"],
  "required_console_events": ["im.message.receive_v1"],
  "jq_root_path": ".",
  "resolved_output_schema": {
    "properties": {
      "event_id": { "description": "Globally unique event ID" },
      "message_id": { "format": "message_id" },
      "chat_id": { "format": "chat_id" },
      "chat_type": { "enum": ["p2p", "group"] },
      "sender_id": { "format": "open_id" },
      "message_type": { "type": "string" },
      "content": { "type": "string" }
    }
  }
}
```

注意：

- `chat_type = p2p` 映射为内部 `chatType = private`。
- Phase 1.5 只接受 `chat_type = p2p`。
- Phase 1.5 只接受 `message_type = text`，非文本先回复不支持或静默记录。
- `sender_id` 是 open_id，可用于当前 `allowedFeishuUsers` 白名单。
- `event_id` 是全局事件 ID，用于 `events(source='feishu_event_consumer')` 去重。

## 5. 新增运行方式

### 5.1 开发命令

新增命令：

```bash
npm run dev:feishu
```

行为：

1. 启动 `im-coding server`。
2. 启动 `lark-cli event consume im.message.receive_v1 --as bot` 子进程。
3. 等待 stderr 出现 ready marker：

```text
[event] ready event_key=im.message.receive_v1
```

4. 按行读取 stdout NDJSON。
5. 将事件转换为内部 `ImInboundEvent`。
6. 调用 Bridge 路由并通过 `FeishuAdapter` 回复。

### 5.2 独立消费者命令

也支持只启动消费者，连接已有 Bridge：

```bash
npm run feishu:events
```

默认转发到：

```text
http://127.0.0.1:4399/internal/feishu/events
```

可通过环境变量覆盖：

```bash
IM_CODING_BRIDGE_URL=http://127.0.0.1:4399 npm run feishu:events
```

## 6. 新增 HTTP API

### `POST /internal/feishu/events`

用途：接收本地 `lark-cli event consume` 归一化后的事件。

请求：

```ts
type FeishuConsumedMessageEvent = {
  type: "im.message.receive_v1";
  event_id: string;
  message_id: string;
  chat_id: string;
  chat_type: "p2p" | "group";
  sender_id: string;
  message_type: string;
  content: string;
  create_time?: string;
  timestamp?: string;
  raw?: unknown;
};
```

转换为：

```ts
type ImInboundEvent = {
  id: string;
  adapter: "feishu";
  eventType: "message_received";
  externalEventId: string;
  externalMessageId: string;
  chatType: "private";
  chatId: string;
  senderId: string;
  text: string;
  raw: unknown;
  receivedAt: string;
};
```

响应：

```json
{
  "ok": true,
  "duplicate": false,
  "replies": ["已发送到 Codex..."]
}
```

## 7. 模块设计

### 7.1 `FeishuEventConsumer`

新增模块：

```text
src/adapters/feishu-event-consumer.js
```

职责：

- spawn `lark-cli event consume im.message.receive_v1 --as bot`。
- 监听 stderr ready marker。
- 解析 stdout NDJSON。
- 将事件 POST 到 Bridge。
- 捕获非零退出并给出可操作错误。
- SIGTERM/SIGINT 时优雅关闭子进程，避免事件订阅泄漏。

不做：

- 不解析复杂业务命令。
- 不直接写 SQLite。
- 不直接调用 Codex Driver。

### 7.2 `FeishuConsumedEventParser`

可放在：

```text
src/adapters/feishu.js
```

或独立：

```text
src/adapters/feishu-consumed-event.js
```

职责：

- 校验字段。
- 过滤非私聊。
- 过滤非文本消息。
- 映射 `p2p -> private`。
- 用 `event_id` 和 `message_id` 构造内部事件。

### 7.3 CLI 扩展

`src/cli.js` 新增命令：

```bash
node src/cli.js feishu-events
node src/cli.js dev
```

建议 npm scripts：

```json
{
  "scripts": {
    "dev:feishu": "node src/cli.js dev",
    "feishu:events": "node src/cli.js feishu-events"
  }
}
```

## 8. 配置

`.env` 增加：

```env
FEISHU_ENABLED=true
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx

IM_CODING_BRIDGE_URL=http://127.0.0.1:4399
IM_CODING_CODEX_DRIVER=stub
```

真实 Codex 验证时再切：

```env
IM_CODING_CODEX_DRIVER=cli
```

开发阶段建议先保持 `stub`，因为这样可以先验证：

```text
飞书真实入站 -> Bridge -> Router -> Feishu 状态回复
```

确认入站稳定后再验证：

```text
Bridge -> Codex CLI -> Hook Stop -> Feishu 最终回复
```

## 9. 权限与飞书后台要求

### 9.1 Scope

需要 app 具备：

```text
im:message.p2p_msg:readonly
```

用于接收私聊消息事件。

发送回复仍需要当前已跑通的消息发送能力。

### 9.2 Event

飞书开发者后台需要启用事件：

```text
im.message.receive_v1
```

如果 `lark-cli event consume` 返回权限或订阅错误，按错误里的 `console_url` 或 `hint` 到飞书后台开通对应权限和事件。

### 9.3 用户白名单

当前 router 已支持：

```yaml
access:
  allowedFeishuUsers:
    - "<open_id>"
```

开发阶段可以留空表示允许所有用户。进入稳定使用前建议只允许自己的 open_id。

## 10. 用户体验验收

### 10.1 启动

开发者运行：

```bash
npm run dev:feishu
```

终端显示：

```text
im-coding server listening on http://127.0.0.1:4399
feishu event consumer ready: im.message.receive_v1
```

### 10.2 私聊指令

用户给 bot 发送：

```text
/projects
```

bot 回复：

```text
可用项目：
1. im-coding
   /use im-coding
```

### 10.3 新建会话

用户：

```text
/use im-coding
/new 飞书真实入站
```

bot 回复当前项目和已创建会话。

### 10.4 发送任务

用户：

```text
帮我确认 Bridge 已经能收到真实飞书消息。
```

stub driver 阶段回复：

```text
已发送到 Codex。
项目：im-coding
会话：飞书真实入站
状态：运行中
```

cli driver 阶段还应在 Codex 完成后收到最终回复。

## 11. 幂等与可靠性

- 入站事件使用 `event_id` 去重。
- 如果没有 `event_id`，使用 `message_id` 兜底。
- `lark-cli event consume` 每行事件只处理一次；Bridge 层仍必须保持幂等。
- consumer 进程退出时不自动重放历史事件；后续如需要补偿再增加本地 pending queue。
- 子进程必须用 SIGTERM 或 stdin EOF 优雅退出，不使用 `kill -9`。

## 12. 错误处理

### 12.1 缺 scope

如果 consumer 返回缺少：

```text
im:message.p2p_msg:readonly
```

提示用户到飞书开发者后台开通，并重新发布或生效应用权限。

### 12.2 未启用事件

如果 consumer 返回事件订阅失败，提示启用：

```text
im.message.receive_v1
```

### 12.3 Bridge 未启动

consumer POST Bridge 失败时：

- 打印错误。
- 保持进程运行。
- 不 ack 业务成功。
- Phase 1.5 不做本地重放队列。

### 12.4 非私聊消息

Phase 1.5 对 `chat_type = group` 直接忽略并记录日志。

### 12.5 非文本消息

Phase 1.5 对非文本消息回复：

```text
当前只支持文本消息。
```

或仅记录事件，具体实现可先选择静默记录，避免打扰用户。

## 13. 开发任务拆分

### Task 1：新增 consumed event parser

- 实现 `parseFeishuConsumedEvent`。
- 单测覆盖 p2p text、group ignore、非文本 ignore、字段缺失。

验收：

- 可把 `im.message.receive_v1` NDJSON 映射为 `ImInboundEvent`。

### Task 2：新增 internal endpoint

- 实现 `POST /internal/feishu/events`。
- 复用 `handleInboundEvent(event, true)`。

验收：

- 手工 POST 消费事件样例，能收到 `/projects` 回复。

### Task 3：新增 event consumer

- spawn `lark-cli event consume im.message.receive_v1 --as bot`。
- 等待 ready marker。
- 逐行 POST Bridge。
- 支持 SIGINT/SIGTERM 优雅退出。

验收：

- `npm run feishu:events` 启动后，用户给 bot 发 `/help`，Bridge 收到事件并回复。

### Task 4：新增 dev 命令

- `node src/cli.js dev` 同时启动 server 和 consumer。
- npm script `dev:feishu`。

验收：

- 一条命令跑起完整本地飞书入站开发链路。

### Task 5：真实 Codex 验证

- 设置 `IM_CODING_CODEX_DRIVER=cli`。
- 从飞书发送普通任务。
- 确认 Codex CLI 启动。
- 确认 Stop 后回发最终回复。

验收：

- 满足“用户发给 bot 后 Codex 可以收到”的真实闭环。

## 14. 成功标准

Spec 002 完成后，必须满足：

- `npm run dev:feishu` 能启动 server 和 event consumer。
- 用户给 bot 私聊 `/projects`，能收到真实 bot 回复。
- 重复同一 `event_id` 不重复触发。
- 用户按 `/use`、`/new`、普通文本操作时，Bridge 能创建本地 run。
- `stub` driver 下可验证入站路由。
- `cli` driver 下 Codex 能收到任务并最终回流消息。

## 15. 后续生产化路径

当本地开发闭环稳定后，再补生产路径：

- 公网 HTTPS webhook。
- 固定域名和 TLS。
- 飞书 challenge/verification 自动化验收。
- 事件加密和签名校验。
- 本地 relay 或云端 relay。
- 断线重放队列。

生产路径不替代本 spec 的开发模式；两者应共享同一套内部 `ImInboundEvent` 和 Router。
