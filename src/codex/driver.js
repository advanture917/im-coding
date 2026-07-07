import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { newId, nowIso } from "../lib/id.js";
import { CodexAppServerClient } from "./app-server-client.js";

export class StubCodexDriver {
  constructor() {
    this.kind = "stub";
  }

  async createThread({ threadId }) {
    return { externalThreadId: threadId, sessionId: threadId };
  }

  async sendMessage({ threadId }) {
    return { runId: newId("stub_run"), sessionId: threadId };
  }

  async cancelRun() {
    return { cancelled: false, reason: "stub driver does not manage a running Codex process" };
  }

  async close() {}
}

export class CliCodexDriver {
  constructor({ config, logger = console }) {
    this.config = config;
    this.logger = logger;
    this.processes = new Map();
  }

  async createThread({ threadId }) {
    return { externalThreadId: threadId, sessionId: threadId };
  }

  async sendMessage({ projectPath, threadId, content }) {
    const runId = newId("codex_run");
    const outputDir = path.join(os.homedir(), ".im-coding", "codex-runs");
    fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, `${runId}.txt`);
    const args = buildCodexExecArgs({
      projectPath,
      sandbox: this.config.sandbox,
      outputPath,
      content,
    });

    const child = spawn(this.config.bin, args, {
      cwd: projectPath,
      stdio: ["ignore", "ignore", "pipe"],
      env: { ...process.env },
    });
    this.processes.set(threadId, child);
    child.stderr.on("data", (chunk) => {
      this.logger.error(`[codex cli] ${chunk.toString("utf8").trim()}`);
    });
    child.on("close", async (code) => {
      this.processes.delete(threadId);
      let finalMessage = null;
      try {
        finalMessage = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8").trim() : null;
      } catch (error) {
        this.logger.error(`[codex cli] failed to read output: ${error.message}`);
      }

      try {
        const tokenEnv = this.config.hookTokenEnv || "IM_CODING_HOOK_TOKEN";
        const token = process.env[tokenEnv];
        await fetch(`${this.config.bridgeUrl || "http://127.0.0.1:4399"}/codex/hooks`, {
          method: "POST",
          headers: {
            "content-type": "application/json; charset=utf-8",
            ...(token ? { "x-im-coding-hook-token": token } : {}),
          },
          body: JSON.stringify({
            id: newId("hook"),
            hookEventName: "Stop",
            sessionId: threadId,
            cwd: projectPath,
            transcriptPath: outputPath,
            payload: {
              status: code === 0 ? "completed" : "failed",
              exitCode: code,
              finalMessage,
            },
            createdAt: nowIso(),
          }),
        });
      } catch (error) {
        this.logger.error(`[codex cli] failed to notify bridge: ${error.message}`);
      }
    });

    return { runId, sessionId: threadId, pid: child.pid };
  }

  async cancelRun({ threadId }) {
    const child = this.processes.get(threadId);
    if (!child) return { cancelled: false, reason: "no live process found" };
    child.kill("SIGTERM");
    return { cancelled: true };
  }

  async close() {
    for (const child of this.processes.values()) child.kill("SIGTERM");
    this.processes.clear();
  }
}

export class AppServerCodexDriver {
  constructor({ config, logger = console, client } = {}) {
    this.kind = "app-server";
    this.config = config;
    this.logger = logger;
    this.client = client || new CodexAppServerClient({ bin: config.bin, logger });
    this.localToCodexThread = new Map();
    this.turns = new Map();
    this.unsubscribe = this.client.onNotification((message) => this.handleNotification(message));
  }

  async createThread({ projectPath, threadId, title }) {
    await this.client.ready();
    const response = await this.client.request("thread/start", buildAppServerThreadStartParams({
      projectPath,
      sandbox: this.config.sandbox,
      approvalPolicy: this.config.approval,
    }));
    const codexThreadId = response.thread.id;
    this.localToCodexThread.set(threadId, codexThreadId);
    if (title) {
      await this.client.request("thread/name/set", { threadId: codexThreadId, name: title });
    }
    return { externalThreadId: codexThreadId, sessionId: codexThreadId };
  }

  async sendMessage({ projectPath, threadId, externalThreadId, content }) {
    await this.client.ready();
    const codexThreadId = externalThreadId || this.localToCodexThread.get(threadId);
    if (!codexThreadId) throw new Error("Missing Codex app-server thread id");

    const response = await this.client.request("turn/start", buildAppServerTurnStartParams({
      codexThreadId,
      projectPath,
      content,
    }));
    const turnId = response.turn.id;
    const runId = newId("codex_app_run");
    this.turns.set(turnId, {
      runId,
      localThreadId: threadId,
      codexThreadId,
      projectPath,
      finalMessage: "",
    });
    return { runId, sessionId: codexThreadId, turnId };
  }

  handleNotification(message) {
    if (message.method === "item/agentMessage/delta") {
      const turn = this.turns.get(message.params?.turnId);
      if (turn) turn.finalMessage += message.params?.delta || "";
      return;
    }

    if (message.method === "turn/completed") {
      this.handleTurnCompleted(message.params).catch((error) => {
        this.logger.error(`[codex app-server] failed to finalize turn: ${error.message}`);
      });
    }
  }

  async handleTurnCompleted(params) {
    const turnId = params?.turn?.id;
    const turn = this.turns.get(turnId);
    if (!turn) return;
    this.turns.delete(turnId);

    const finalFromItems = finalMessageFromTurn(params.turn);
    const finalMessage = (turn.finalMessage || finalFromItems || "").trim();
    const status = params.turn?.status === "failed" ? "failed" : "completed";
    const error = params.turn?.error?.message || params.turn?.error || null;
    await this.notifyBridge({
      sessionId: turn.codexThreadId,
      cwd: turn.projectPath,
      finalMessage,
      status,
      error,
      turnId,
    });
  }

  async notifyBridge({ sessionId, cwd, finalMessage, status, error, turnId }) {
    const tokenEnv = this.config.hookTokenEnv || "IM_CODING_HOOK_TOKEN";
    const token = process.env[tokenEnv];
    await fetch(`${this.config.bridgeUrl || "http://127.0.0.1:4399"}/codex/hooks`, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        ...(token ? { "x-im-coding-hook-token": token } : {}),
      },
      body: JSON.stringify({
        id: newId("hook"),
        hookEventName: "Stop",
        sessionId,
        cwd,
        payload: {
          status,
          finalMessage,
          error,
          turnId,
        },
        createdAt: nowIso(),
      }),
    });
  }

  async cancelRun({ threadId, externalThreadId }) {
    await this.client.ready();
    const codexThreadId = externalThreadId || this.localToCodexThread.get(threadId);
    if (!codexThreadId) return { cancelled: false, reason: "no Codex app-server thread found" };
    await this.client.request("turn/interrupt", { threadId: codexThreadId });
    return { cancelled: true };
  }

  async close() {
    this.unsubscribe?.();
    await this.client.close();
  }
}

export function createCodexDriver({ config, logger }) {
  if (config.driver === "app-server") return new AppServerCodexDriver({ config, logger });
  if (config.driver === "cli") return new CliCodexDriver({ config, logger });
  return new StubCodexDriver();
}

export function buildCodexExecArgs({ projectPath, sandbox = "workspace-write", outputPath, content }) {
  return [
    "exec",
    "--skip-git-repo-check",
    "-C",
    projectPath,
    "-s",
    sandbox,
    "-o",
    outputPath,
    "--json",
    content,
  ];
}

export function buildAppServerThreadStartParams({ projectPath, sandbox = "workspace-write", approvalPolicy = "never" }) {
  return {
    cwd: projectPath,
    sandbox,
    approvalPolicy,
    threadSource: "im-coding-feishu",
  };
}

export function buildAppServerTurnStartParams({ codexThreadId, projectPath, content }) {
  return {
    threadId: codexThreadId,
    cwd: projectPath,
    input: [{ type: "text", text: content, text_elements: [] }],
  };
}

export function finalMessageFromTurn(turn) {
  const messages = (turn?.items || [])
    .filter((item) => item.type === "agentMessage" && item.text)
    .map((item) => item.text.trim())
    .filter(Boolean);
  return messages.at(-1) || "";
}
