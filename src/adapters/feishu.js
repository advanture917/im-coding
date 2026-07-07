import { splitLongText } from "../lib/text.js";

function envValue(name) {
  return name ? process.env[name] : undefined;
}

function textFromFeishuContent(content) {
  if (!content) return "";
  if (typeof content === "object") return content.text ?? "";
  try {
    const parsed = JSON.parse(content);
    return parsed.text ?? "";
  } catch {
    return String(content);
  }
}

export function parseFeishuWebhook(body) {
  if (body?.type === "url_verification") {
    return { kind: "challenge", challenge: body.challenge, token: body.token };
  }

  const event = body?.event ?? {};
  const message = event.message ?? body?.message ?? {};
  const sender = event.sender ?? body?.sender ?? {};
  const senderId = sender.sender_id ?? sender.id ?? {};
  const externalUserId =
    senderId.open_id || senderId.user_id || senderId.union_id || sender.open_id || body.senderId;
  const chatType = message.chat_type || body.chatType;
  const normalizedChatType = chatType === "p2p" || chatType === "private" ? "private" : chatType;

  return {
    kind: "message",
    id: body?.header?.event_id || body?.event_id || message.message_id,
    adapter: "feishu",
    eventType: "message_received",
    externalEventId: body?.header?.event_id || body?.event_id || message.message_id,
    externalMessageId: message.message_id,
    appId: body?.header?.app_id,
    token: body?.header?.token || body?.token,
    chatType: normalizedChatType,
    chatId: message.chat_id || body.chatId,
    senderId: externalUserId,
    text: textFromFeishuContent(message.content ?? body.text),
    raw: body,
    receivedAt: new Date().toISOString(),
  };
}

export function mockInboundEvent(body) {
  const now = Date.now();
  return {
    id: body.eventId || `mock_evt_${now}`,
    adapter: "feishu",
    eventType: "message_received",
    externalEventId: body.eventId || `mock_evt_${now}`,
    externalMessageId: body.messageId || `mock_msg_${now}`,
    chatType: "private",
    chatId: body.chatId || "mock_chat",
    senderId: body.senderId || "mock_user",
    text: body.text || "",
    raw: body,
    receivedAt: new Date().toISOString(),
  };
}

export class FeishuAdapter {
  constructor({ config, store, logger = console }) {
    this.config = config;
    this.store = store;
    this.logger = logger;
    this.cachedToken = null;
    this.cachedTokenExpiresAt = 0;
  }

  verify(parsed) {
    const expectedToken = envValue(this.config.verificationTokenEnv);
    if (expectedToken && parsed.token && parsed.token !== expectedToken) {
      const error = new Error("Invalid Feishu verification token");
      error.statusCode = 401;
      throw error;
    }

    const expectedAppId = envValue(this.config.appIdEnv);
    if (expectedAppId && parsed.appId && parsed.appId !== expectedAppId) {
      const error = new Error("Invalid Feishu app_id");
      error.statusCode = 401;
      throw error;
    }
  }

  async sendText({ chatId, text }) {
    const parts = splitLongText(text, this.config.maxTextLength || 3500);
    const results = [];
    for (const part of parts) {
      results.push(await this.sendOneText({ chatId, text: part }));
    }
    return results;
  }

  async sendOneText({ chatId, text }) {
    const appId = envValue(this.config.appIdEnv);
    const appSecret = envValue(this.config.appSecretEnv);
    if (!this.config.enabled || !appId || !appSecret) {
      this.store.recordOutbound({
        adapter: "feishu",
        externalChatId: chatId,
        content: text,
        status: "sent",
      });
      this.logger.log(`[feishu dry-run] ${chatId}: ${text}`);
      return { ok: true, dryRun: true };
    }

    let lastError;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const token = await this.getTenantAccessToken(appId, appSecret);
        const response = await fetch(
          "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id",
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${token}`,
              "content-type": "application/json; charset=utf-8",
            },
            body: JSON.stringify({
              receive_id: chatId,
              msg_type: "text",
              content: JSON.stringify({ text }),
            }),
          },
        );
        const payload = await response.json();
        if (!response.ok || payload.code !== 0) {
          throw new Error(payload.msg || `Feishu send failed with ${response.status}`);
        }
        this.store.recordOutbound({
          adapter: "feishu",
          externalChatId: chatId,
          content: text,
          status: "sent",
        });
        return { ok: true, messageId: payload?.data?.message_id };
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, attempt * 250));
      }
    }

    this.store.recordOutbound({
      adapter: "feishu",
      externalChatId: chatId,
      content: text,
      status: "failed",
      error: lastError?.message,
    });
    throw lastError;
  }

  async getTenantAccessToken(appId, appSecret) {
    const now = Date.now();
    if (this.cachedToken && this.cachedTokenExpiresAt > now + 60_000) {
      return this.cachedToken;
    }

    const response = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    });
    const payload = await response.json();
    if (!response.ok || payload.code !== 0) {
      throw new Error(payload.msg || `Feishu token failed with ${response.status}`);
    }
    this.cachedToken = payload.tenant_access_token;
    this.cachedTokenExpiresAt = now + Number(payload.expire || 7200) * 1000;
    return this.cachedToken;
  }
}
