import test from "node:test";
import assert from "node:assert/strict";
import { defaultConfig } from "../src/config.js";

function withEnv(values, fn) {
  const previous = {};
  for (const key of Object.keys(values)) {
    previous[key] = process.env[key];
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("defaultConfig reads env-only runtime configuration", () => {
  const config = withEnv(
    {
      IM_CODING_STORE_PATH: "~/custom/im-coding.db",
      IM_CODING_CODEX_DRIVER: "app-server",
      IM_CODING_BRIDGE_URL: "http://127.0.0.1:5000",
      IM_CODING_CODEX_SANDBOX: "read-only",
      IM_CODING_CODEX_APPROVAL: "on-request",
      IM_CODING_PROJECT_ID: "demo",
      IM_CODING_PROJECT_NAME: "Demo Project",
      IM_CODING_PROJECT_ROOT: "/tmp/demo",
      IM_CODING_PROJECT_TOOL: "codex",
      IM_CODING_ALLOWED_FEISHU_USERS: "ou_1, ou_2",
    },
    () => defaultConfig("/tmp/fallback"),
  );

  assert.equal(config.store.path, "~/custom/im-coding.db");
  assert.equal(config.codex.driver, "app-server");
  assert.equal(config.codex.bridgeUrl, "http://127.0.0.1:5000");
  assert.equal(config.codex.sandbox, "read-only");
  assert.equal(config.codex.approval, "on-request");
  assert.deepEqual(config.projects, [
    {
      id: "demo",
      name: "Demo Project",
      rootPath: "/tmp/demo",
      codingTool: "codex",
      status: "active",
    },
  ]);
  assert.deepEqual(config.access.allowedFeishuUsers, ["ou_1", "ou_2"]);
});

test("defaultConfig supports multiple projects via JSON env", () => {
  const config = withEnv(
    {
      IM_CODING_PROJECTS_JSON:
        '[{"id":"one","name":"One","rootPath":"/tmp/one","codingTool":"codex","status":"active"}]',
    },
    () => defaultConfig("/tmp/fallback"),
  );

  assert.deepEqual(config.projects, [
    {
      id: "one",
      name: "One",
      rootPath: "/tmp/one",
      codingTool: "codex",
      status: "active",
    },
  ]);
});
