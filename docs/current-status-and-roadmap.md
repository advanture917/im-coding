# 当前状态与路线图

## 已实现

- Bridge HTTP 服务：`GET /health`、入站/出站内部接口、Codex hook 接口。
- 配置：只读 `.env` 和进程环境变量；本地配置用 `cp .env.example .env`。
- 存储：SQLite，默认 `~/.im-coding/im-coding.db`，保存用户、项目、会话、消息、事件、运行和出站消息。
- 飞书私聊文本入站：webhook、`lark-cli event consume`、mock inbound、事件去重、用户白名单。
- 飞书文本回复：dry-run、真实发送、tenant token 缓存、长文本分片、失败记录。
- 指令：`/help`、`/status`、`/projects`、`/use`、`/new`、`/threads`、`/switch`、`/cancel`。
- Codex driver：`stub`、`cli`、`app-server`。
- Codex hook：`POST /codex/hooks`，支持 token 校验、thread 映射、Stop 事件回传、hook 去重。
- 测试：parser、HTTP endpoint、飞书事件、长文本分片、Codex driver 协议形状、Stop hook 回传。

## 当前限制

- 只支持飞书私聊文本；不支持群聊、图片、文件、富文本、语音。
- 飞书 webhook `encrypt` 字段尚未解密。
- SQLite 依赖 `sqlite3` CLI，尚无正式 migration。
- `app-server` 依赖 Codex experimental API。
- `cli` 是一次性执行路径，不等价于完整线程续聊。
- 无 Web 管理界面、消息补偿、死信队列和生产级监控。

## TODO

### P0

- 支持飞书加密事件解密和签名/时间戳校验。
- 给 `lark-cli` 消费进程加自动重启、退避和健康状态。
- 启动前检查 `sqlite3`、`lark-cli`、Codex bin、飞书凭据。
- 给 Codex app-server driver 加协议兼容检查和清晰错误提示。
- 给运行任务加超时和失败收敛。

### P1

- 增加 `/rename`、`/history`、`/retry`、`/clear` 或 `/archive`。
- 支持同一会话任务排队。
- 回传关键 Codex 流式进度。
- 把内部错误映射成用户可理解的提示。
- 支持项目级权限、管理员角色、项目别名和默认项目。
- 在 `/status` 显示 Git 分支和未提交变更。

### P2

- 支持飞书群聊、富文本、图片、文件、卡片和引用关系。
- 引入正式 SQLite driver 和 schema migration。
- 完整出站消息状态机、重试和人工补偿命令。
- 结构化日志、request id、metrics 和健康详情。
- 展示 Codex 文件变更摘要、测试结果和最终回复。
- 支持高风险操作确认、项目级 sandbox/approval/model、多 Codex worker。

### P3

- Web 管理界面。
- Dockerfile 和部署示例。
- systemd、launchd 或 pm2 运行示例。
- 飞书应用配置指南。
- 端到端验收脚本。
- 发布版本和 changelog 流程。
