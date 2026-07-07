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
- `codex app-server`、`codex remote-control`：标记为 experimental，本次不作为默认实现。

## Phase 1 实现选择

MVP 已实现两种 Driver：

- `stub`：默认模式，只创建本地 run，等待 `/codex/hooks` 回流；适合本地开发、飞书链路验证和集成测试。
- `cli`：实验模式，调用 `codex exec` 启动一次 non-interactive run，并在进程结束后向 Bridge 发送合成 `Stop` hook。开启方式：

```yaml
codex:
  driver: cli
```

## 风险

- `codex exec` 是“新消息触发新 run”的路径，不等价于桌面端完整线程续聊体验。
- `resume`、App Server、Remote Control 的稳定线程接口仍需继续验证。
- transcript 格式不视为稳定协议，最终回复优先使用 hook payload 或 `--output-last-message` 文件。
