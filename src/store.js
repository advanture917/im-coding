import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { newId, nowIso } from "./lib/id.js";

function sqlValue(value) {
  if (value === undefined || value === null) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function rowToCamel(row) {
  const result = {};
  for (const [key, value] of Object.entries(row)) {
    result[key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }
  return result;
}

export class SqliteStore {
  constructor(dbPath, sqliteBin = "sqlite3") {
    this.dbPath = dbPath;
    this.sqliteBin = sqliteBin;
  }

  init() {
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    this.run(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        display_name TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS im_bindings (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        adapter TEXT NOT NULL,
        external_user_id TEXT NOT NULL,
        external_chat_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(adapter, external_user_id, external_chat_id)
      );
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        root_path TEXT NOT NULL,
        coding_tool TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        external_thread_id TEXT,
        codex_session_id TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS chat_contexts (
        id TEXT PRIMARY KEY,
        adapter TEXT NOT NULL,
        external_chat_id TEXT NOT NULL,
        external_user_id TEXT NOT NULL,
        current_project_id TEXT,
        current_thread_id TEXT,
        updated_at TEXT NOT NULL,
        UNIQUE(adapter, external_chat_id, external_user_id)
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT,
        source TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        external_message_id TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        event_type TEXT NOT NULL,
        external_event_id TEXT,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(source, external_event_id)
      );
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        status TEXT NOT NULL,
        codex_session_id TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT
      );
      CREATE TABLE IF NOT EXISTS outbound_messages (
        id TEXT PRIMARY KEY,
        adapter TEXT NOT NULL,
        external_chat_id TEXT NOT NULL,
        content TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        created_at TEXT NOT NULL,
        sent_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_threads_project_updated ON threads(project_id, updated_at);
      CREATE INDEX IF NOT EXISTS idx_runs_thread_status ON runs(thread_id, status);
      CREATE INDEX IF NOT EXISTS idx_context_thread ON chat_contexts(current_thread_id);
    `);
  }

  run(sql) {
    const result = spawnSync(this.sqliteBin, [this.dbPath], {
      input: sql,
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 10,
    });
    if (result.status !== 0) {
      throw new Error(result.stderr || `sqlite exited with ${result.status}`);
    }
  }

  query(sql) {
    const result = spawnSync(this.sqliteBin, ["-json", this.dbPath, sql], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 10,
    });
    if (result.status !== 0) {
      throw new Error(result.stderr || `sqlite exited with ${result.status}`);
    }
    const output = result.stdout.trim();
    if (!output) return [];
    return JSON.parse(output).map(rowToCamel);
  }

  execWithChanges(sql) {
    const rows = this.query(`BEGIN; ${sql}; SELECT changes() AS changes; COMMIT;`);
    return Number(rows.at(-1)?.changes ?? 0);
  }

  seedProjects(projects = []) {
    const now = nowIso();
    for (const project of projects) {
      this.run(`
        INSERT INTO projects (id, name, root_path, coding_tool, status, created_at, updated_at)
        VALUES (${sqlValue(project.id)}, ${sqlValue(project.name)}, ${sqlValue(project.rootPath)},
          ${sqlValue(project.codingTool)}, ${sqlValue(project.status || "active")},
          ${sqlValue(now)}, ${sqlValue(now)})
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          root_path = excluded.root_path,
          coding_tool = excluded.coding_tool,
          status = excluded.status,
          updated_at = excluded.updated_at;
      `);
    }
  }

  markRunningRunsUnknown() {
    const now = nowIso();
    this.run(`
      UPDATE runs SET status = 'unknown', finished_at = ${sqlValue(now)} WHERE status = 'running';
      UPDATE threads SET status = 'unknown', updated_at = ${sqlValue(now)} WHERE status = 'running';
    `);
  }

  insertEvent({ id = newId("evt"), source, eventType, externalEventId, payload, createdAt = nowIso() }) {
    const external = externalEventId || id;
    const changes = this.execWithChanges(`
      INSERT OR IGNORE INTO events (id, source, event_type, external_event_id, payload_json, created_at)
      VALUES (${sqlValue(id)}, ${sqlValue(source)}, ${sqlValue(eventType)}, ${sqlValue(external)},
        ${sqlValue(JSON.stringify(payload ?? {}))}, ${sqlValue(createdAt)})
    `);
    return { id, inserted: changes > 0 };
  }

  ensureBinding({ adapter, externalUserId, externalChatId, displayName }) {
    const now = nowIso();
    const userId = `${adapter}:${externalUserId}`;
    this.run(`
      INSERT INTO users (id, display_name, created_at, updated_at)
      VALUES (${sqlValue(userId)}, ${sqlValue(displayName || externalUserId)}, ${sqlValue(now)}, ${sqlValue(now)})
      ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, updated_at = excluded.updated_at;
      INSERT OR IGNORE INTO im_bindings (id, user_id, adapter, external_user_id, external_chat_id, created_at, updated_at)
      VALUES (${sqlValue(newId("bind"))}, ${sqlValue(userId)}, ${sqlValue(adapter)},
        ${sqlValue(externalUserId)}, ${sqlValue(externalChatId)}, ${sqlValue(now)}, ${sqlValue(now)});
      INSERT OR IGNORE INTO chat_contexts (id, adapter, external_chat_id, external_user_id, updated_at)
      VALUES (${sqlValue(newId("ctx"))}, ${sqlValue(adapter)}, ${sqlValue(externalChatId)},
        ${sqlValue(externalUserId)}, ${sqlValue(now)});
    `);
    return { userId };
  }

  getContext(adapter, externalChatId, externalUserId) {
    return this.query(`
      SELECT * FROM chat_contexts
      WHERE adapter = ${sqlValue(adapter)}
        AND external_chat_id = ${sqlValue(externalChatId)}
        AND external_user_id = ${sqlValue(externalUserId)}
      LIMIT 1
    `).at(0) ?? null;
  }

  updateContext({ adapter, externalChatId, externalUserId, currentProjectId, currentThreadId }) {
    const now = nowIso();
    this.run(`
      INSERT INTO chat_contexts (id, adapter, external_chat_id, external_user_id, current_project_id, current_thread_id, updated_at)
      VALUES (${sqlValue(newId("ctx"))}, ${sqlValue(adapter)}, ${sqlValue(externalChatId)},
        ${sqlValue(externalUserId)}, ${sqlValue(currentProjectId)}, ${sqlValue(currentThreadId)}, ${sqlValue(now)})
      ON CONFLICT(adapter, external_chat_id, external_user_id) DO UPDATE SET
        current_project_id = excluded.current_project_id,
        current_thread_id = excluded.current_thread_id,
        updated_at = excluded.updated_at;
    `);
  }

  listProjects() {
    return this.query("SELECT * FROM projects WHERE status = 'active' ORDER BY name ASC");
  }

  getProject(projectId) {
    return this.query(`SELECT * FROM projects WHERE id = ${sqlValue(projectId)} OR name = ${sqlValue(projectId)} LIMIT 1`).at(0) ?? null;
  }

  createThread({ projectId, title, externalThreadId, codexSessionId }) {
    const now = nowIso();
    const id = newId("thr");
    this.run(`
      INSERT INTO threads (id, project_id, title, external_thread_id, codex_session_id, status, created_at, updated_at)
      VALUES (${sqlValue(id)}, ${sqlValue(projectId)}, ${sqlValue(title || "未命名会话")},
        ${sqlValue(externalThreadId)}, ${sqlValue(codexSessionId || id)}, 'idle', ${sqlValue(now)}, ${sqlValue(now)})
    `);
    return this.getThread(id);
  }

  updateThread(id, fields) {
    const assignments = [];
    const map = {
      title: "title",
      status: "status",
      externalThreadId: "external_thread_id",
      codexSessionId: "codex_session_id",
    };
    for (const [key, column] of Object.entries(map)) {
      if (Object.hasOwn(fields, key)) assignments.push(`${column} = ${sqlValue(fields[key])}`);
    }
    assignments.push(`updated_at = ${sqlValue(nowIso())}`);
    this.run(`UPDATE threads SET ${assignments.join(", ")} WHERE id = ${sqlValue(id)}`);
    return this.getThread(id);
  }

  getThread(id) {
    return this.query(`SELECT * FROM threads WHERE id = ${sqlValue(id)} LIMIT 1`).at(0) ?? null;
  }

  findThreadBySession(sessionId) {
    return this.query(`SELECT * FROM threads WHERE codex_session_id = ${sqlValue(sessionId)} OR id = ${sqlValue(sessionId)} LIMIT 1`).at(0) ?? null;
  }

  findThreadByCwd(cwd) {
    if (!cwd) return null;
    return this.query(`
      SELECT threads.* FROM threads
      JOIN projects ON projects.id = threads.project_id
      WHERE projects.root_path = ${sqlValue(cwd)}
      ORDER BY
        CASE WHEN threads.status = 'running' THEN 0 ELSE 1 END,
        threads.updated_at DESC
      LIMIT 1
    `).at(0) ?? null;
  }

  listThreads(projectId, limit = 10) {
    return this.query(`
      SELECT * FROM threads
      WHERE project_id = ${sqlValue(projectId)}
      ORDER BY updated_at DESC
      LIMIT ${Number(limit)}
    `);
  }

  findThreadByPrefix(projectId, prefix) {
    return this.query(`
      SELECT * FROM threads
      WHERE project_id = ${sqlValue(projectId)}
        AND id LIKE ${sqlValue(`${prefix}%`)}
      ORDER BY updated_at DESC
      LIMIT 2
    `);
  }

  insertMessage({ threadId, source, role, content, externalMessageId, createdAt = nowIso() }) {
    const id = newId("msg");
    this.run(`
      INSERT INTO messages (id, thread_id, source, role, content, external_message_id, created_at)
      VALUES (${sqlValue(id)}, ${sqlValue(threadId)}, ${sqlValue(source)}, ${sqlValue(role)},
        ${sqlValue(content)}, ${sqlValue(externalMessageId)}, ${sqlValue(createdAt)})
    `);
    return { id };
  }

  createRun({ threadId, codexSessionId }) {
    const id = newId("run");
    this.run(`
      INSERT INTO runs (id, thread_id, status, codex_session_id, started_at)
      VALUES (${sqlValue(id)}, ${sqlValue(threadId)}, 'running', ${sqlValue(codexSessionId)}, ${sqlValue(nowIso())})
    `);
    this.updateThread(threadId, { status: "running", codexSessionId });
    return this.getRun(id);
  }

  getRun(id) {
    return this.query(`SELECT * FROM runs WHERE id = ${sqlValue(id)} LIMIT 1`).at(0) ?? null;
  }

  getActiveRun(threadId) {
    return this.query(`
      SELECT * FROM runs
      WHERE thread_id = ${sqlValue(threadId)}
        AND status IN ('running', 'cancel_requested', 'unknown')
      ORDER BY started_at DESC
      LIMIT 1
    `).at(0) ?? null;
  }

  finishActiveRun(threadId, status = "completed") {
    const now = nowIso();
    this.run(`
      UPDATE runs SET status = ${sqlValue(status)}, finished_at = ${sqlValue(now)}
      WHERE id IN (
        SELECT id FROM runs
        WHERE thread_id = ${sqlValue(threadId)} AND status IN ('running', 'cancel_requested', 'unknown')
        ORDER BY started_at DESC
        LIMIT 1
      );
    `);
    this.updateThread(threadId, { status });
  }

  requestCancel(threadId) {
    const now = nowIso();
    this.run(`
      UPDATE runs SET status = 'cancel_requested'
      WHERE thread_id = ${sqlValue(threadId)} AND status = 'running';
      UPDATE threads SET status = 'cancel_requested', updated_at = ${sqlValue(now)}
      WHERE id = ${sqlValue(threadId)};
    `);
  }

  findContextsForThread(threadId) {
    return this.query(`
      SELECT * FROM chat_contexts
      WHERE current_thread_id = ${sqlValue(threadId)}
      ORDER BY updated_at DESC
    `);
  }

  recordOutbound({ adapter, externalChatId, content, status = "pending", error }) {
    const id = newId("out");
    const now = nowIso();
    this.run(`
      INSERT INTO outbound_messages (id, adapter, external_chat_id, content, status, error, created_at, sent_at)
      VALUES (${sqlValue(id)}, ${sqlValue(adapter)}, ${sqlValue(externalChatId)}, ${sqlValue(content)},
        ${sqlValue(status)}, ${sqlValue(error)}, ${sqlValue(now)}, ${status === "sent" ? sqlValue(now) : "NULL"})
    `);
    return { id };
  }

  recentOutbound(limit = 20) {
    return this.query(`SELECT * FROM outbound_messages ORDER BY created_at DESC LIMIT ${Number(limit)}`);
  }
}
