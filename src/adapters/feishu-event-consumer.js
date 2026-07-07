import { spawn } from "node:child_process";
import { parseFeishuConsumedEvent, FEISHU_MESSAGE_RECEIVE_EVENT } from "./feishu-consumed-event.js";

const READY_MARKER = `[event] ready event_key=${FEISHU_MESSAGE_RECEIVE_EVENT}`;

function bridgeEventsUrl(bridgeUrl) {
  return new URL("/internal/feishu/events", bridgeUrl).toString();
}

function isSensitiveLine(line) {
  return /app[_-]?secret|tenant_access_token|authorization/i.test(line);
}

export class FeishuEventConsumer {
  constructor({
    bridgeUrl = process.env.IM_CODING_BRIDGE_URL || "http://127.0.0.1:4399",
    command = process.env.LARK_CLI_BIN || "lark-cli",
    args = ["event", "consume", FEISHU_MESSAGE_RECEIVE_EVENT, "--as", "bot"],
    logger = console,
    fetchImpl = fetch,
  } = {}) {
    this.bridgeUrl = bridgeUrl;
    this.eventsUrl = bridgeEventsUrl(bridgeUrl);
    this.command = command;
    this.args = args;
    this.logger = logger;
    this.fetch = fetchImpl;
    this.child = null;
    this.stdoutBuffer = "";
    this.stderrBuffer = "";
    this.ready = false;
    this.stopping = false;
  }

  start() {
    if (this.child) return this.child;
    this.child = spawn(this.command, this.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });

    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.handleStdout(chunk));
    this.child.stderr.on("data", (chunk) => this.handleStderr(chunk));
    this.child.on("error", (error) => {
      this.logger.error(`feishu event consumer failed to start: ${error.message}`);
    });
    this.child.on("exit", (code, signal) => {
      this.child = null;
      if (this.stopping) return;
      if (code !== 0) {
        this.logger.error(
          `feishu event consumer exited with code ${code ?? "null"} signal ${signal ?? "null"}. ` +
            "Check Feishu app scope im:message.p2p_msg:readonly and console event im.message.receive_v1.",
        );
      }
    });
    return this.child;
  }

  waitUntilReady(timeoutMs = 30_000) {
    if (this.ready) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out waiting for ${READY_MARKER}`));
      }, timeoutMs);
      const onReady = () => {
        cleanup();
        resolve();
      };
      const onExit = (code) => {
        cleanup();
        reject(new Error(`Feishu event consumer exited before ready with code ${code ?? "null"}`));
      };
      const cleanup = () => {
        clearTimeout(timer);
        this.offReady = null;
        this.child?.off("exit", onExit);
      };
      this.offReady = onReady;
      this.child?.once("exit", onExit);
    });
  }

  handleStdout(chunk) {
    this.stdoutBuffer += chunk;
    const lines = this.stdoutBuffer.split(/\r?\n/);
    this.stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) this.handleLine(trimmed).catch((error) => this.logger.error(error.message));
    }
  }

  handleStderr(chunk) {
    this.stderrBuffer += chunk;
    const lines = this.stderrBuffer.split(/\r?\n/);
    this.stderrBuffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.includes(READY_MARKER)) {
        this.ready = true;
        this.logger.log(`feishu event consumer ready: ${FEISHU_MESSAGE_RECEIVE_EVENT}`);
        this.offReady?.();
        continue;
      }
      if (!isSensitiveLine(trimmed)) this.logger.error(`[feishu event consumer] ${trimmed}`);
    }
  }

  async handleLine(line) {
    let payload;
    try {
      payload = JSON.parse(line);
    } catch (error) {
      this.logger.error(`failed to parse Feishu event NDJSON line: ${error.message}`);
      return;
    }

    const event = parseFeishuConsumedEvent(payload);
    if (!event) return;

    try {
      const response = await this.fetch(this.eventsUrl, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const text = await response.text();
        this.logger.error(`Bridge rejected Feishu event ${event.externalEventId}: ${response.status} ${text}`);
      }
    } catch (error) {
      this.logger.error(`failed to forward Feishu event ${event.externalEventId} to Bridge: ${error.message}`);
    }
  }

  async stop(signal = "SIGTERM") {
    this.stopping = true;
    const child = this.child;
    if (!child) return;
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.child) child.kill(signal);
        resolve();
      }, 5_000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      child.stdin?.end();
    });
  }
}

export { READY_MARKER as FEISHU_EVENT_READY_MARKER };
