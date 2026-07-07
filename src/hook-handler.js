import { CodexTranscriptReader } from "./codex/transcript-reader.js";

const FALLBACK_FINAL =
  "Codex 已结束，但 im-coding 暂未能提取最终回复。\n请在 Codex 桌面端查看完整结果。";

function finalMessageFromPayload(event, transcriptReader) {
  const payload = event.payload ?? {};
  return (
    payload.finalMessage ||
    payload.final_message ||
    payload.output ||
    payload.summary ||
    transcriptReader.readFinalMessage(event.transcriptPath) ||
    null
  );
}

export class CodexHookHandler {
  constructor({ config, store, feishuAdapter, transcriptReader = new CodexTranscriptReader() }) {
    this.config = config;
    this.store = store;
    this.feishuAdapter = feishuAdapter;
    this.transcriptReader = transcriptReader;
  }

  verify(req) {
    const tokenEnv = this.config.server?.hookTokenEnv || "IM_CODING_HOOK_TOKEN";
    const expected = process.env[tokenEnv];
    if (!expected) return;
    const provided =
      req.headers["x-im-coding-hook-token"] ||
      String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (provided !== expected) {
      const error = new Error("Invalid hook token");
      error.statusCode = 401;
      throw error;
    }
  }

  async handle(event) {
    const inserted = this.store.insertEvent({
      id: event.id,
      source: "codex_hook",
      eventType: event.hookEventName,
      externalEventId: event.id,
      payload: event,
      createdAt: event.createdAt,
    });
    if (!inserted.inserted) return { duplicate: true };

    const thread = this.store.findThreadBySession(event.sessionId) || this.store.findThreadByCwd(event.cwd);
    if (!thread) return { ok: true, mapped: false };

    if (event.hookEventName === "Stop") {
      const payloadStatus = event.payload?.status;
      const final = finalMessageFromPayload(event, this.transcriptReader);
      const status = payloadStatus === "failed" ? "failed" : "completed";
      this.store.insertMessage({
        threadId: thread.id,
        source: "agent",
        role: "assistant",
        content: final || FALLBACK_FINAL,
      });
      this.store.finishActiveRun(thread.id, status);

      const contexts = this.store.findContextsForThread(thread.id);
      const text = final ? `Codex 已完成。\n\n${final}` : FALLBACK_FINAL;
      for (const context of contexts) {
        await this.feishuAdapter.sendText({ chatId: context.externalChatId, text });
      }
      return { ok: true, mapped: true, sent: contexts.length };
    }

    return { ok: true, mapped: true };
  }
}
