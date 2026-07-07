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

function parseScalar(value) {
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((item) => parseScalar(item.trim()));
  }
  return trimmed;
}

// Minimal YAML reader for the config shape used by this project.
function parseSimpleYaml(source) {
  const root = {};
  const stack = [{ indent: -1, value: root }];
  const lines = source.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    if (!rawLine.trim() || rawLine.trimStart().startsWith("#")) continue;
    const indent = rawLine.match(/^ */)?.[0].length ?? 0;
    const line = rawLine.trim();
    while (stack.length > 1 && indent <= stack.at(-1).indent) stack.pop();
    const parent = stack.at(-1).value;

    if (line.startsWith("- ")) {
      if (!Array.isArray(parent)) {
        throw new Error("Invalid YAML: list item has no list parent");
      }
      const itemText = line.slice(2);
      if (itemText.includes(":")) {
        const [key, ...valueParts] = itemText.split(":");
        const item = {};
        parent.push(item);
        const valueText = valueParts.join(":").trim();
        if (valueText) item[key.trim()] = parseScalar(valueText);
        stack.push({ indent, value: item });
      } else {
        parent.push(parseScalar(itemText));
      }
      continue;
    }

    const [keyPart, ...valueParts] = line.split(":");
    const key = keyPart.trim();
    const valueText = valueParts.join(":").trim();
    if (valueText) {
      parent[key] = parseScalar(valueText);
      continue;
    }

    const nextLine = lines.slice(index + 1).find((candidate) => candidate.trim());
    const child = nextLine?.trim().startsWith("- ") ? [] : {};
    parent[key] = child;
    stack.push({ indent, value: child });
  }

  return root;
}

function deepMerge(base, override) {
  if (!override || typeof override !== "object" || Array.isArray(override)) return override ?? base;
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      result[key] = deepMerge(base?.[key] ?? {}, value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function applyEnvOverrides(config) {
  if (process.env.IM_CODING_HOST !== undefined) config.server.host = process.env.IM_CODING_HOST;
  if (process.env.IM_CODING_PORT !== undefined) {
    config.server.port = parseNumberEnv("IM_CODING_PORT", config.server.port);
  }
  if (process.env.FEISHU_ENABLED !== undefined) {
    config.feishu.enabled = parseBoolEnv("FEISHU_ENABLED", config.feishu.enabled);
  }
  if (process.env.FEISHU_MAX_TEXT_LENGTH !== undefined) {
    config.feishu.maxTextLength = parseNumberEnv("FEISHU_MAX_TEXT_LENGTH", config.feishu.maxTextLength);
  }
  if (process.env.IM_CODING_CODEX_DRIVER !== undefined) {
    config.codex.driver = process.env.IM_CODING_CODEX_DRIVER;
  }
  if (process.env.CODEX_BIN !== undefined) {
    config.codex.bin = process.env.CODEX_BIN;
  }
  return config;
}

export function defaultConfig(cwd = process.cwd()) {
  return {
    server: {
      host: process.env.IM_CODING_HOST || "127.0.0.1",
      port: parseNumberEnv("IM_CODING_PORT", 4399),
      hookTokenEnv: "IM_CODING_HOOK_TOKEN",
    },
    store: {
      type: "sqlite",
      path: "~/.im-coding/im-coding.db",
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
      bridgeUrl: "http://127.0.0.1:4399",
      sandbox: "workspace-write",
      approval: "never",
    },
    projects: [
      {
        id: "im-coding",
        name: "im-coding",
        rootPath: cwd,
        codingTool: "codex",
        status: "active",
      },
    ],
    access: {
      allowedFeishuUsers: [],
    },
  };
}

export function loadConfig(cwd = process.cwd()) {
  loadDotEnv(cwd);
  const configPath = expandHome(process.env.IM_CODING_CONFIG || "~/.im-coding/config.yaml");
  let loaded = {};
  if (fs.existsSync(configPath)) {
    const content = fs.readFileSync(configPath, "utf8");
    loaded = configPath.endsWith(".json") ? JSON.parse(content) : parseSimpleYaml(content);
  }
  const merged = applyEnvOverrides(deepMerge(defaultConfig(cwd), loaded));
  merged.store.path = expandHome(merged.store.path);
  for (const project of merged.projects ?? []) {
    project.rootPath = expandHome(project.rootPath);
    project.status ||= "active";
    project.codingTool ||= "codex";
  }
  return merged;
}
