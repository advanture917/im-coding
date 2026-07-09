#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./config.js";
import { ImCodingServer } from "./server.js";
import { FeishuEventConsumer } from "./adapters/feishu-event-consumer.js";

function writeDefaultEnv(cwd = process.cwd()) {
  const envPath = path.join(cwd, ".env");
  if (fs.existsSync(envPath)) {
    console.log(`.env already exists: ${envPath}`);
    return;
  }
  const examplePath = path.join(cwd, ".env.example");
  const content = fs.existsSync(examplePath)
    ? fs.readFileSync(examplePath, "utf8")
    : [
        "FEISHU_ENABLED=true",
        "FEISHU_APP_ID=cli_xxxxxxxxxxxxxxxx",
        "FEISHU_APP_SECRET=replace_with_app_secret",
        "IM_CODING_CODEX_DRIVER=app-server",
        "",
      ].join("\n");
  fs.writeFileSync(envPath, content, "utf8");
  console.log(`Created env config: ${envPath}`);
}

async function main() {
  const command = process.argv[2] || "server";
  if (command === "init-env") {
    writeDefaultEnv(process.cwd());
    return;
  }

  if (command === "server") {
    const config = loadConfig(process.cwd());
    const server = new ImCodingServer({ config });
    await server.listen();
    console.log(`im-coding server listening on http://${config.server.host}:${config.server.port}`);
    console.log(`im-coding codex driver: ${config.codex.driver}`);
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
    console.log(`im-coding codex driver: ${config.codex.driver}`);

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
