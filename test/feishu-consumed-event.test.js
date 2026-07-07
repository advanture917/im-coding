import test from "node:test";
import assert from "node:assert/strict";
import { parseFeishuConsumedEvent } from "../src/adapters/feishu-consumed-event.js";

test("parseFeishuConsumedEvent maps p2p text event to ImInboundEvent", () => {
  const event = parseFeishuConsumedEvent({
    type: "im.message.receive_v1",
    event_id: "evt_1",
    message_id: "om_1",
    chat_id: "oc_1",
    chat_type: "p2p",
    sender_id: "ou_1",
    message_type: "text",
    content: "/projects",
    create_time: "2026-07-06T00:00:00.000Z",
  });

  assert.deepEqual(
    {
      id: event.id,
      adapter: event.adapter,
      eventType: event.eventType,
      externalEventId: event.externalEventId,
      externalMessageId: event.externalMessageId,
      chatType: event.chatType,
      chatId: event.chatId,
      senderId: event.senderId,
      text: event.text,
      receivedAt: event.receivedAt,
    },
    {
      id: "evt_1",
      adapter: "feishu",
      eventType: "message_received",
      externalEventId: "evt_1",
      externalMessageId: "om_1",
      chatType: "private",
      chatId: "oc_1",
      senderId: "ou_1",
      text: "/projects",
      receivedAt: "2026-07-06T00:00:00.000Z",
    },
  );
});

test("parseFeishuConsumedEvent ignores group and non-text events", () => {
  assert.equal(
    parseFeishuConsumedEvent({
      type: "im.message.receive_v1",
      event_id: "evt_group",
      message_id: "om_group",
      chat_id: "oc_group",
      chat_type: "group",
      sender_id: "ou_1",
      message_type: "text",
      content: "/projects",
    }),
    null,
  );

  assert.equal(
    parseFeishuConsumedEvent({
      type: "im.message.receive_v1",
      event_id: "evt_image",
      message_id: "om_image",
      chat_id: "oc_1",
      chat_type: "p2p",
      sender_id: "ou_1",
      message_type: "image",
      content: "",
    }),
    null,
  );
});

test("parseFeishuConsumedEvent rejects missing required fields", () => {
  assert.throws(
    () =>
      parseFeishuConsumedEvent({
        type: "im.message.receive_v1",
        event_id: "evt_missing",
        chat_id: "oc_1",
        chat_type: "p2p",
        sender_id: "ou_1",
        message_type: "text",
        content: "/projects",
      }),
    /missing message_id/,
  );
});

test("parseFeishuConsumedEvent accepts message id alias and ms timestamps", () => {
  const event = parseFeishuConsumedEvent({
    type: "im.message.receive_v1",
    event_id: "evt_alias",
    id: "om_alias",
    chat_id: "oc_1",
    chat_type: "p2p",
    sender_id: "ou_1",
    message_type: "text",
    content: "/help",
    timestamp: "1783296000000",
  });

  assert.equal(event.externalMessageId, "om_alias");
  assert.equal(event.receivedAt, "2026-07-06T00:00:00.000Z");
});
