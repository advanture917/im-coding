#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defaultConfig, loadConfig } from "./config.js";
import { ImCodingServer } from "./server.js";
import { FeishuEventConsumer } from "./adapters/feishu-event-consumer.js";

function writeDefaultConfig() {
  const configPath = path.join(os.homedir(), ".im-coding", "config.yaml");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  if (fs.existsSync(configPath)) {
    console.log(`配置已存在：${configPath}`);
    return;
  }
  const config = defaultConfig(process.cwd());
  const content = `server:
  host: ${config.server.host}
  port: ${config.server.port}
  hookTokenEnv: ${config.server.hookTokenEnv}

store:
  type: sqlite
  path: ~/.im-coding/im-coding.db

feishu:
  enabled: false
  appIdEnv: FEISHU_APP_ID
  appSecretEnv: FEISHU_APP_SECRET
  verificationTokenEnv: FEISHU_VERIFICATION_TOKEN
  encryptKeyEnv: FEISHU_ENCRYPT_KEY
  maxTextLength: 3500

codex:
  driver: stub
  bin: ${config.codex.bin}
  bridgeUrl: http://127.0.0.1:4399
  sandbox: workspace-write
  approval: never

projects:
  - id: im-coding
    name: im-coding
    rootPath: ${process.cwd()}
    codingTool: codex
    status: active

access:
  allowedFeishuUsers: []
`;
  fs.writeFileSync(configPath, content, "utf8");
  console.log(`已创建配置：${configPath}`);
}

async function main() {
  const command = process.argv[2] || "server";
  if (command === "init-config") {
    writeDefaultConfig();
    return;
  }

  if (command === "server") {
    const config = loadConfig(process.cwd());
    const server = new ImCodingServer({ config });
    await server.listen();
    console.log(`im-coding server listening on http://${config.server.host}:${config.server.port}`);
    return;
  }

  if (command === "feishu-events") {
    loadConfig(process.cwd());
    const consumer = new FeishuEventConsumer();
    consumer.start();
    try {
      await consumer.waitUntilReady();
    } catch (error) {
      console.error(error.message);
      await consumer.stop();
      process.exitCode = 1;
      return;
    }
    const stop = async () => {
      await consumer.stop();
      process.exit();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    return;
  }

  if (command === "dev") {
    const config = loadConfig(process.cwd());
    const server = new ImCodingServer({ config });
    await server.listen();
    console.log(`im-coding server listening on http://${config.server.host}:${config.server.port}`);

    const bridgeUrl = process.env.IM_CODING_BRIDGE_URL || `http://${config.server.host}:${config.server.port}`;
    const consumer = new FeishuEventConsumer({ bridgeUrl });
    consumer.start();
    try {
      await consumer.waitUntilReady();
    } catch (error) {
      console.error(error.message);
      await consumer.stop();
      await server.close();
      process.exitCode = 1;
      return;
    }

    const stop = async () => {
      await consumer.stop();
      await server.close();
      process.exit();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    return;
  }

  {
    console.error(`未知命令：${command}`);
    process.exitCode = 1;
    return;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
