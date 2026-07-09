import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function parseEnvValue(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseBoolEnv(name, fallback) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function parseNumberEnv(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseCsvEnv(name, fallback = []) {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") return fallback;
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseJsonEnv(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") return fallback;
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`Invalid JSON in ${name}: ${error.message}`);
  }
}

export function loadDotEnv(cwd = process.cwd(), fileName = ".env") {
  const envPath = path.join(cwd, fileName);
  if (!fs.existsSync(envPath)) return { loaded: false, path: envPath };

  const content = fs.readFileSync(envPath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const normalized = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const equalIndex = normalized.indexOf("=");
    if (equalIndex <= 0) continue;
    const key = normalized.slice(0, equalIndex).trim();
    const value = parseEnvValue(normalized.slice(equalIndex + 1));
    if (!Object.hasOwn(process.env, key)) process.env[key] = value;
  }

  return { loaded: true, path: envPath };
}

function expandHome(value) {
  if (typeof value !== "string") return value;
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

export function defaultConfig(cwd = process.cwd()) {
  const projects = parseJsonEnv("IM_CODING_PROJECTS_JSON", [
    {
      id: process.env.IM_CODING_PROJECT_ID || "im-coding",
      name: process.env.IM_CODING_PROJECT_NAME || process.env.IM_CODING_PROJECT_ID || "im-coding",
      rootPath: process.env.IM_CODING_PROJECT_ROOT || cwd,
      codingTool: process.env.IM_CODING_PROJECT_TOOL || "codex",
      status: process.env.IM_CODING_PROJECT_STATUS || "active",
    },
  ]);
  return {
    server: {
      host: process.env.IM_CODING_HOST || "127.0.0.1",
      port: parseNumberEnv("IM_CODING_PORT", 4399),
      hookTokenEnv: "IM_CODING_HOOK_TOKEN",
    },
    store: {
      type: "sqlite",
      path: process.env.IM_CODING_STORE_PATH || "~/.im-coding/im-coding.db",
    },
    feishu: {
      enabled: parseBoolEnv("FEISHU_ENABLED", false),
      appIdEnv: "FEISHU_APP_ID",
      appSecretEnv: "FEISHU_APP_SECRET",
      verificationTokenEnv: "FEISHU_VERIFICATION_TOKEN",
      encryptKeyEnv: "FEISHU_ENCRYPT_KEY",
      maxTextLength: parseNumberEnv("FEISHU_MAX_TEXT_LENGTH", 3500),
    },
    codex: {
      driver: process.env.IM_CODING_CODEX_DRIVER || "stub",
      bin: process.env.CODEX_BIN || "/Applications/Codex.app/Contents/Resources/codex",
      bridgeUrl: process.env.IM_CODING_BRIDGE_URL || "http://127.0.0.1:4399",
      sandbox: process.env.IM_CODING_CODEX_SANDBOX || "workspace-write",
      approval: process.env.IM_CODING_CODEX_APPROVAL || "never",
    },
    projects,
    access: {
      allowedFeishuUsers: parseCsvEnv("IM_CODING_ALLOWED_FEISHU_USERS", []),
    },
  };
}

export function loadConfig(cwd = process.cwd()) {
  loadDotEnv(cwd);
  const merged = defaultConfig(cwd);
  merged.store.path = expandHome(merged.store.path);
  for (const project of merged.projects ?? []) {
    project.rootPath = expandHome(project.rootPath);
    project.status ||= "active";
    project.codingTool ||= "codex";
  }
  return merged;
}
