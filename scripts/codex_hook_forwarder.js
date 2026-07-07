#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function main() {
  const bridgeUrl = process.env.IM_CODING_BRIDGE_URL || "http://127.0.0.1:4399";
  const token = process.env.IM_CODING_HOOK_TOKEN;
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  const payload = raw ? JSON.parse(raw) : {};

  try {
    const response = await fetch(`${bridgeUrl}/codex/hooks`, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        ...(token ? { "x-im-coding-hook-token": token } : {}),
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`bridge responded ${response.status}`);
  } catch (error) {
    const queueDir = path.join(os.homedir(), ".im-coding", "pending-hooks");
    fs.mkdirSync(queueDir, { recursive: true });
    const file = path.join(queueDir, `${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
    fs.writeFileSync(file, JSON.stringify({ payload, error: error.message, queuedAt: new Date().toISOString() }, null, 2));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 0;
});
