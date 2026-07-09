# Spec 001 Codex Driver Spike Result

日期：2026-07-06

## 结论

当前本机可用 Codex CLI：

```text
/Applications/Codex.app/Contents/Resources/codex
```

已确认公开命令包含：

- `codex exec`：非交互执行，支持 `-C <dir>`、`--skip-git-repo-check`、`--json`、`-o/--output-last-message <file>`。
- `codex exec resume`：可恢复既有 session，但本次未把它纳入稳定 MVP。
- `codex app-server`、`codex remote-control`：标记为 experimental；后续已验证 `codex app-server` 可以创建真实 Codex thread 并启动 turn。

## Phase 1 实现选择与后续更新

MVP 最初实现两种 Driver：

- `stub`：默认模式，只创建本地 run，等待 `/codex/hooks` 回流；适合本地开发、飞书链路验证和集成测试。
- `cli`：实验模式，调用 `codex exec` 启动一次 non-interactive run，并在进程结束后向 Bridge 发送合成 `Stop` hook。开启方式：

```env
IM_CODING_CODEX_DRIVER=cli
```

后续已增加第三种 Driver：

- `app-server`：通过 `codex app-server` JSONL 协议创建真实 Codex thread，设置 thread name，启动 turn，监听 `item/agentMessage/delta` 和 `turn/completed`，并把最终回复回传 Bridge。开启方式：

```env
IM_CODING_CODEX_DRIVER=app-server
```

然后使用简单启动命令：

```bash
npm run dev:feishu
```

## 风险

- `codex exec` 是“新消息触发新 run”的路径，不等价于桌面端完整线程续聊体验。
- `app-server` 更接近桌面端线程体验，但当前仍属于 Codex experimental 接口，协议变化可能需要同步调整 driver。
- `resume`、Remote Control 的稳定线程接口仍需继续验证。
- transcript 格式不视为稳定协议，最终回复优先使用 hook payload 或 `--output-last-message` 文件。
