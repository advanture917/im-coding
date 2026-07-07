import { newId } from "../lib/id.js";

const EVENT_TYPE = "im.message.receive_v1";

function textFromConsumedContent(content) {
  if (content === undefined || content === null) return "";
  if (typeof content === "object") return content.text ?? "";
  return String(content);
}

function requiredString(value, field) {
  if (typeof value === "string" && value.length > 0) return value;
  const error = new Error(`Invalid Feishu consumed event: missing ${field}`);
  error.statusCode = 400;
  throw error;
}

function receivedAtFromConsumedEvent(body) {
  const value = body.create_time || body.timestamp;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const date = new Date(Number(value));
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return value || new Date().toISOString();
}

export function parseFeishuConsumedEvent(body) {
  if (!body || typeof body !== "object") {
    const error = new Error("Invalid Feishu consumed event");
    error.statusCode = 400;
    throw error;
  }

  const type = body.type || EVENT_TYPE;
  if (type !== EVENT_TYPE) {
    const error = new Error(`Unsupported Feishu consumed event type: ${type}`);
    error.statusCode = 400;
    throw error;
  }

  const chatType = requiredString(body.chat_type, "chat_type");
  const messageType = requiredString(body.message_type, "message_type");
  if (chatType !== "p2p") return null;
  if (messageType !== "text") return null;

  const messageId = body.message_id || body.id;
  const externalEventId = body.event_id || messageId;
  const externalMessageId = requiredString(messageId, "message_id");
  const receivedAt = receivedAtFromConsumedEvent(body);

  return {
    id: externalEventId || newId("feishu_evt"),
    adapter: "feishu",
    eventType: "message_received",
    externalEventId: externalEventId || externalMessageId,
    externalMessageId,
    chatType: "private",
    chatId: requiredString(body.chat_id, "chat_id"),
    senderId: requiredString(body.sender_id, "sender_id"),
    text: textFromConsumedContent(body.content),
    raw: body.raw ?? body,
    receivedAt,
  };
}

export { EVENT_TYPE as FEISHU_MESSAGE_RECEIVE_EVENT };
