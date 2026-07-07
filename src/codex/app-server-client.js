import readline from "node:readline";
import { spawn } from "node:child_process";

export class CodexAppServerClient {
  constructor({ bin, logger = console } = {}) {
    this.bin = bin;
    this.logger = logger;
    this.child = null;
    this.nextId = 1;
    this.pending = new Map();
    this.notificationHandlers = new Set();
    this.readyPromise = null;
  }

  async ready() {
    if (!this.readyPromise) this.readyPromise = this.start();
    return this.readyPromise;
  }

  async start() {
    this.child = spawn(this.bin, ["app-server"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8").trim();
      if (text) this.logger.error(`[codex app-server] ${text}`);
    });
    this.child.on("close", (code) => {
      for (const { reject } of this.pending.values()) {
        reject(new Error(`codex app-server exited with code ${code ?? "null"}`));
      }
      this.pending.clear();
      this.child = null;
      this.readyPromise = null;
    });

    const lines = readline.createInterface({ input: this.child.stdout });
    lines.on("line", (line) => this.handleLine(line));

    await this.request("initialize", {
      clientInfo: {
        name: "im_coding_feishu_bridge",
        title: "im-coding Feishu Bridge",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: true,
      },
    });
    this.notify("initialized", {});
  }

  handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      this.logger.error(`[codex app-server] failed to parse JSONL: ${error.message}`);
      return;
    }

    if (Object.hasOwn(message, "id") && (Object.hasOwn(message, "result") || Object.hasOwn(message, "error"))) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message || `codex app-server error ${message.error.code}`));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message.method) {
      if (Object.hasOwn(message, "id")) {
        this.respondToServerRequest(message);
        return;
      }
      for (const handler of this.notificationHandlers) handler(message);
    }
  }

  respondToServerRequest(message) {
    this.write({
      id: message.id,
      error: {
        code: -32601,
        message: `im-coding does not handle app-server request ${message.method}`,
      },
    });
  }

  onNotification(handler) {
    this.notificationHandlers.add(handler);
    return () => this.notificationHandlers.delete(handler);
  }

  request(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    const payload = { id, method, params };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write(payload);
    });
  }

  notify(method, params = {}) {
    this.write({ method, params });
  }

  write(payload) {
    if (!this.child?.stdin?.writable) throw new Error("codex app-server is not running");
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  async close() {
    const child = this.child;
    if (!child) return;
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.child) child.kill("SIGTERM");
        resolve();
      }, 5_000);
      child.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
      child.stdin?.end();
    });
  }
}
