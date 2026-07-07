import test from "node:test";
import assert from "node:assert/strict";
import {
  AppServerCodexDriver,
  buildAppServerThreadStartParams,
  buildAppServerTurnStartParams,
  buildCodexExecArgs,
  finalMessageFromTurn,
} from "../src/codex/driver.js";

test("buildCodexExecArgs uses current codex exec flags", () => {
  const args = buildCodexExecArgs({
    projectPath: "/tmp/project",
    sandbox: "workspace-write",
    outputPath: "/tmp/output.txt",
    content: "hello",
  });

  assert.deepEqual(args, [
    "exec",
    "--skip-git-repo-check",
    "-C",
    "/tmp/project",
    "-s",
    "workspace-write",
    "-o",
    "/tmp/output.txt",
    "--json",
    "hello",
  ]);
  assert.equal(args.includes("-a"), false);
});

test("app-server param builders use v2 thread and turn shapes", () => {
  assert.deepEqual(
    buildAppServerThreadStartParams({
      projectPath: "/tmp/project",
      sandbox: "workspace-write",
      approvalPolicy: "never",
    }),
    {
      cwd: "/tmp/project",
      sandbox: "workspace-write",
      approvalPolicy: "never",
      threadSource: "im-coding-feishu",
    },
  );

  assert.deepEqual(
    buildAppServerTurnStartParams({
      codexThreadId: "codex_thr_1",
      projectPath: "/tmp/project",
      content: "hello",
    }),
    {
      threadId: "codex_thr_1",
      cwd: "/tmp/project",
      input: [{ type: "text", text: "hello", text_elements: [] }],
    },
  );
});

test("finalMessageFromTurn returns the last assistant message", () => {
  assert.equal(
    finalMessageFromTurn({
      items: [
        { type: "agentMessage", text: "first" },
        { type: "commandExecution", aggregatedOutput: "ignored" },
        { type: "agentMessage", text: "final" },
      ],
    }),
    "final",
  );
});

test("AppServerCodexDriver creates named Codex thread and starts turns", async () => {
  const calls = [];
  const handlers = new Set();
  const client = {
    onNotification(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    async ready() {},
    async request(method, params) {
      calls.push({ method, params });
      if (method === "thread/start") {
        return { thread: { id: "codex_thr_1" } };
      }
      if (method === "thread/name/set") {
        return {};
      }
      if (method === "turn/start") {
        return { turn: { id: "turn_1" } };
      }
      throw new Error(`unexpected method ${method}`);
    },
    async close() {},
  };
  const driver = new AppServerCodexDriver({
    config: {
      bin: "codex",
      sandbox: "workspace-write",
      approval: "never",
      bridgeUrl: "http://127.0.0.1:4399",
    },
    client,
    logger: { error() {} },
  });

  const prepared = await driver.createThread({
    projectPath: "/tmp/project",
    threadId: "local_thr_1",
    title: "Feishu test",
  });
  assert.deepEqual(prepared, { externalThreadId: "codex_thr_1", sessionId: "codex_thr_1" });

  const sent = await driver.sendMessage({
    projectPath: "/tmp/project",
    threadId: "local_thr_1",
    externalThreadId: prepared.externalThreadId,
    content: "hello",
  });
  assert.equal(sent.sessionId, "codex_thr_1");
  assert.equal(sent.turnId, "turn_1");
  assert.equal(calls[0].method, "thread/start");
  assert.deepEqual(calls[1], {
    method: "thread/name/set",
    params: { threadId: "codex_thr_1", name: "Feishu test" },
  });
  assert.equal(calls[2].method, "turn/start");
});
