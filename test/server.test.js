import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defaultConfig } from "../src/config.js";
import { ImCodingServer } from "../src/server.js";

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  return response.json();
}

async function createTestServer(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "im-coding-test-"));
  const config = defaultConfig(dir);
  config.server.port = 0;
  config.store.path = path.join(dir, "im-coding.db");
  config.feishu.enabled = false;
  config.projects[0].rootPath = dir;
  const server = new ImCodingServer({ config, logger: { log() {}, error() {} } });
  await server.listen();
  t.after(() => server.close());
  const address = server.httpServer.address();
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

test("health endpoint responds", async (t) => {
  const { baseUrl } = await createTestServer(t);
  const response = await fetch(`${baseUrl}/health`);
  assert.deepEqual(await response.json(), { ok: true, service: "im-coding", version: "0.1.0" });
});

test("mock Feishu command loop manages context and dedupes inbound events", async (t) => {
  const { baseUrl } = await createTestServer(t);

  let result = await postJson(`${baseUrl}/internal/mock/feishu/inbound`, {
    eventId: "evt_projects",
    messageId: "msg_projects",
    chatId: "chat_1",
    senderId: "user_1",
    text: "/projects",
  });
  assert.equal(result.ok, true);
  assert.match(result.replies[0], /可用项目/);

  result = await postJson(`${baseUrl}/internal/mock/feishu/inbound`, {
    eventId: "evt_projects",
    messageId: "msg_projects",
    chatId: "chat_1",
    senderId: "user_1",
    text: "/projects",
  });
  assert.equal(result.duplicate, true);

  result = await postJson(`${baseUrl}/internal/mock/feishu/inbound`, {
    eventId: "evt_use",
    messageId: "msg_use",
    chatId: "chat_1",
    senderId: "user_1",
    text: "/use im-coding",
  });
  assert.match(result.replies[0], /当前项目：im-coding/);

  result = await postJson(`${baseUrl}/internal/mock/feishu/inbound`, {
    eventId: "evt_new",
    messageId: "msg_new",
    chatId: "chat_1",
    senderId: "user_1",
    text: "/new 需求文档",
  });
  assert.match(result.replies[0], /已创建会话：需求文档/);
});

test("internal Feishu consumed event endpoint routes and dedupes event_id", async (t) => {
  const { baseUrl } = await createTestServer(t);

  const body = {
    type: "im.message.receive_v1",
    event_id: "evt_consumed_projects",
    message_id: "om_consumed_projects",
    chat_id: "oc_consumed_1",
    chat_type: "p2p",
    sender_id: "ou_consumed_1",
    message_type: "text",
    content: "/projects",
  };

  let result = await postJson(`${baseUrl}/internal/feishu/events`, body);
  assert.equal(result.ok, true);
  assert.equal(result.duplicate, false);
  assert.match(result.replies[0], /可用项目/);

  result = await postJson(`${baseUrl}/internal/feishu/events`, {
    ...body,
    message_id: "om_consumed_projects_retry",
    content: "/help",
  });
  assert.equal(result.ok, true);
  assert.equal(result.duplicate, true);
  assert.deepEqual(result.replies, []);
});

test("internal Feishu consumed event endpoint ignores unsupported event shapes", async (t) => {
  const { baseUrl } = await createTestServer(t);

  const result = await postJson(`${baseUrl}/internal/feishu/events`, {
    type: "im.message.receive_v1",
    event_id: "evt_consumed_group",
    message_id: "om_consumed_group",
    chat_id: "oc_group",
    chat_type: "group",
    sender_id: "ou_consumed_1",
    message_type: "text",
    content: "/projects",
  });

  assert.deepEqual(result, { ok: true, ignored: true, replies: [] });
});

test("prompt creates running thread and Stop hook sends final message", async (t) => {
  const { server, baseUrl } = await createTestServer(t);
  await postJson(`${baseUrl}/internal/mock/feishu/inbound`, {
    eventId: "evt_use",
    messageId: "msg_use",
    chatId: "chat_1",
    senderId: "user_1",
    text: "/use im-coding",
  });
  await postJson(`${baseUrl}/internal/mock/feishu/inbound`, {
    eventId: "evt_new",
    messageId: "msg_new",
    chatId: "chat_1",
    senderId: "user_1",
    text: "/new MVP",
  });
  const promptResult = await postJson(`${baseUrl}/internal/mock/feishu/inbound`, {
    eventId: "evt_prompt",
    messageId: "msg_prompt",
    chatId: "chat_1",
    senderId: "user_1",
    text: "帮我补 Bridge 接口设计",
  });
  assert.match(promptResult.replies[0], /状态：运行中/);

  const thread = server.store.listThreads("im-coding", 1)[0];
  const hookResult = await postJson(`${baseUrl}/codex/hooks`, {
    id: "hook_stop_1",
    hookEventName: "Stop",
    sessionId: thread.id,
    payload: { finalMessage: "已完成接口设计。" },
    createdAt: new Date().toISOString(),
  });
  assert.equal(hookResult.ok, true);
  assert.equal(hookResult.sent, 1);

  const outbound = server.store.recentOutbound(1)[0];
  assert.match(outbound.content, /Codex 已完成/);
  assert.match(outbound.content, /已完成接口设计/);
});
