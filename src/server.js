import http from "node:http";
import { loadConfig } from "./config.js";
import { readJson, sendJson, notFound } from "./lib/http.js";
import { SqliteStore } from "./store.js";
import { FeishuAdapter, mockInboundEvent, parseFeishuWebhook } from "./adapters/feishu.js";
import { parseFeishuConsumedEvent } from "./adapters/feishu-consumed-event.js";
import { createCodexDriver } from "./codex/driver.js";
import { CommandRouter } from "./router.js";
import { CodexHookHandler } from "./hook-handler.js";

export class ImCodingServer {
  constructor({ config = loadConfig(), logger = console } = {}) {
    this.config = config;
    this.logger = logger;
    this.store = new SqliteStore(config.store.path);
    this.feishuAdapter = new FeishuAdapter({ config: config.feishu, store: this.store, logger });
    this.codexDriver = createCodexDriver({
      config: {
        ...config.codex,
        hookTokenEnv: config.server.hookTokenEnv,
      },
      logger,
    });
    this.router = new CommandRouter({ config, store: this.store, codexDriver: this.codexDriver });
    this.hookHandler = new CodexHookHandler({ config, store: this.store, feishuAdapter: this.feishuAdapter });
  }

  init() {
    this.store.init();
    this.store.seedProjects(this.config.projects);
    this.store.markRunningRunsUnknown();
  }

  listen() {
    this.init();
    this.httpServer = http.createServer((req, res) => {
      this.handle(req, res).catch((error) => {
        const status = error.statusCode || 500;
        this.logger.error(error);
        sendJson(res, status, { ok: false, error: error.message });
      });
    });
    return new Promise((resolve) => {
      this.httpServer.listen(this.config.server.port, this.config.server.host, () => {
        resolve(this.httpServer);
      });
    });
  }

  close() {
    return new Promise((resolve, reject) => {
      if (!this.httpServer) {
        this.codexDriver.close?.().then(resolve, reject);
        return;
      }
      this.httpServer.close((error) => (error ? reject(error) : resolve()));
    }).then(() => this.codexDriver.close?.());
  }

  async handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);

    if (req.method === "GET" && url.pathname === "/health") {
      return sendJson(res, 200, { ok: true, service: "im-coding", version: "0.1.0" });
    }

    if (req.method === "GET" && url.pathname === "/internal/outbound") {
      return sendJson(res, 200, { ok: true, messages: this.store.recentOutbound() });
    }

    if (req.method === "POST" && url.pathname === "/webhooks/feishu/events") {
      const body = await readJson(req);
      const parsed = parseFeishuWebhook(body);
      this.feishuAdapter.verify(parsed);
      if (parsed.kind === "challenge") {
        return sendJson(res, 200, { challenge: parsed.challenge });
      }
      const result = await this.handleInboundEvent(parsed, true);
      return sendJson(res, 200, result);
    }

    if (req.method === "POST" && url.pathname === "/internal/mock/feishu/inbound") {
      const body = await readJson(req);
      const result = await this.handleInboundEvent(mockInboundEvent(body), true);
      return sendJson(res, 200, result);
    }

    if (req.method === "POST" && url.pathname === "/internal/feishu/events") {
      const body = await readJson(req);
      const event = parseFeishuConsumedEvent(body);
      if (!event) return sendJson(res, 200, { ok: true, ignored: true, replies: [] });
      const result = await this.handleInboundEvent(event, true);
      return sendJson(res, 200, result);
    }

    if (req.method === "POST" && url.pathname === "/internal/feishu/send") {
      const body = await readJson(req);
      const result = await this.feishuAdapter.sendText({ chatId: body.chatId, text: body.text });
      return sendJson(res, 200, { ok: true, result });
    }

    if (req.method === "POST" && url.pathname === "/codex/hooks") {
      this.hookHandler.verify(req);
      const body = await readJson(req);
      const result = await this.hookHandler.handle(body);
      return sendJson(res, 200, { ok: true, ...result });
    }

    return notFound(res);
  }

  async handleInboundEvent(event, sendReplies) {
    if (!event.externalEventId || !event.externalMessageId || !event.chatId || !event.senderId) {
      const error = new Error("Incomplete Feishu inbound event");
      error.statusCode = 400;
      throw error;
    }

    const dedupe = this.store.insertEvent({
      id: event.id,
      source: "feishu",
      eventType: event.eventType,
      externalEventId: event.externalEventId || event.externalMessageId,
      payload: event.raw,
      createdAt: event.receivedAt,
    });
    if (!dedupe.inserted) return { ok: true, duplicate: true, replies: [] };

    const replies = await this.router.routeInbound(event);
    if (sendReplies) {
      for (const reply of replies) {
        await this.feishuAdapter.sendText({ chatId: event.chatId, text: reply });
      }
    }
    return { ok: true, duplicate: false, replies };
  }
}
