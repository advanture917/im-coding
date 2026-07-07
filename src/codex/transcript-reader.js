import fs from "node:fs";

function contentToText(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map(contentToText).filter(Boolean).join("\n");
  }
  if (typeof value === "object") {
    return value.text || value.content || value.message || "";
  }
  return "";
}

export class CodexTranscriptReader {
  readFinalMessage(transcriptPath) {
    if (!transcriptPath || !fs.existsSync(transcriptPath)) return null;
    const content = fs.readFileSync(transcriptPath, "utf8");
    const lines = content.split(/\r?\n/).filter(Boolean);
    let finalText = null;

    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        const role = event.role || event.message?.role || event.item?.role;
        const type = event.type || event.event || event.kind;
        const text =
          contentToText(event.finalMessage) ||
          contentToText(event.final_message) ||
          contentToText(event.message?.content) ||
          contentToText(event.item?.content) ||
          contentToText(event.content) ||
          contentToText(event.text);

        if (text && (role === "assistant" || String(type).includes("assistant") || String(type).includes("final"))) {
          finalText = text;
        }
      } catch {
        if (line.trim()) finalText = line.trim();
      }
    }

    return finalText;
  }
}
