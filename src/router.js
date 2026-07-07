import { commandLine } from "./lib/text.js";
import { nowIso } from "./lib/id.js";

const HELP_TEXT = `im-coding 已连接。

常用指令：
/projects 查看项目
/use <project> 切换项目
/new [title] 新建会话
/threads 查看会话
/switch <thread> 切换会话
/status 查看当前状态
/cancel 取消当前运行`;

function isAllowed(config, senderId) {
  const allowed = config.access?.allowedFeishuUsers ?? [];
  return allowed.length === 0 || allowed.includes(senderId);
}

function threadLabel(thread) {
  if (!thread) return "未选择";
  return `${thread.title} (${thread.status})`;
}

export class CommandRouter {
  constructor({ config, store, codexDriver }) {
    this.config = config;
    this.store = store;
    this.codexDriver = codexDriver;
  }

  async routeInbound(event) {
    if (event.chatType !== "private") {
      return ["Phase 1 只支持飞书私聊。"];
    }
    if (!isAllowed(this.config, event.senderId)) {
      return ["你还没有被授权使用 im-coding。\n请联系管理员把你的飞书 user id 加入 allowedFeishuUsers。"];
    }

    this.store.ensureBinding({
      adapter: event.adapter,
      externalUserId: event.senderId,
      externalChatId: event.chatId,
    });

    const command = commandLine(event.text);
    if (command) return this.routeCommand(event, command);
    return this.routePrompt(event);
  }

  async routeCommand(event, command) {
    switch (command.name) {
      case "/help":
        return [HELP_TEXT];
      case "/status":
        return [this.status(event)];
      case "/projects":
        return [this.projects()];
      case "/use":
        return [this.useProject(event, command.args)];
      case "/new":
        return [await this.newThread(event, command.args)];
      case "/threads":
        return [this.threads(event)];
      case "/switch":
        return [this.switchThread(event, command.args)];
      case "/cancel":
        return [await this.cancel(event)];
      default:
        return [`未知指令：${command.name}\n发送 /help 查看可用指令。`];
    }
  }

  context(event) {
    return this.store.getContext(event.adapter, event.chatId, event.senderId);
  }

  status(event) {
    const context = this.context(event);
    const project = context?.currentProjectId ? this.store.getProject(context.currentProjectId) : null;
    const thread = context?.currentThreadId ? this.store.getThread(context.currentThreadId) : null;
    const run = thread ? this.store.getActiveRun(thread.id) : null;
    return [
      "im-coding 状态：已连接",
      `飞书用户：${event.senderId}（已授权）`,
      `当前项目：${project ? `${project.name} (${project.id})` : "未选择"}`,
      `当前会话：${threadLabel(thread)}`,
      `当前运行：${run ? run.status : "无"}`,
      "Bridge：ok",
    ].join("\n");
  }

  projects() {
    const projects = this.store.listProjects();
    if (!projects.length) return "暂无可用项目。";
    return [
      "可用项目：",
      ...projects.map((project, index) => `${index + 1}. ${project.name}\n   /use ${project.id}`),
    ].join("\n");
  }

  useProject(event, projectId) {
    if (!projectId) return "用法：/use <project>";
    const project = this.store.getProject(projectId);
    if (!project) return `未找到项目：${projectId}\n发送 /projects 查看可用项目。`;
    this.store.updateContext({
      adapter: event.adapter,
      externalChatId: event.chatId,
      externalUserId: event.senderId,
      currentProjectId: project.id,
      currentThreadId: null,
    });
    return [
      `当前项目：${project.name}`,
      "当前会话：未选择",
      "发送 /new 创建会话，或 /threads 查看最近会话。",
    ].join("\n");
  }

  async newThread(event, title) {
    const context = this.context(event);
    if (!context?.currentProjectId) {
      return "还没有选择项目。\n发送 /projects 查看项目，然后使用 /use <project> 切换。";
    }
    const project = this.store.getProject(context.currentProjectId);
    if (!project) return "当前项目不存在，请重新 /use。";

    const threadTitle = title || `会话 ${new Date().toLocaleString("zh-CN", { hour12: false })}`;
    const thread = this.store.createThread({ projectId: project.id, title: threadTitle });
    const prepared = await this.codexDriver.createThread({
      projectId: project.id,
      projectPath: project.rootPath,
      threadId: thread.id,
      title: threadTitle,
    });
    const updated = this.store.updateThread(thread.id, {
      externalThreadId: prepared.externalThreadId,
      codexSessionId: prepared.sessionId || thread.id,
    });
    this.store.updateContext({
      adapter: event.adapter,
      externalChatId: event.chatId,
      externalUserId: event.senderId,
      currentProjectId: project.id,
      currentThreadId: updated.id,
    });
    return [`已创建会话：${updated.title}`, `项目：${project.name}`, "现在可以直接发送任务内容。"].join("\n");
  }

  threads(event) {
    const context = this.context(event);
    if (!context?.currentProjectId) {
      return "还没有选择项目。\n发送 /projects 查看项目，然后使用 /use <project> 切换。";
    }
    const threads = this.store.listThreads(context.currentProjectId, 10);
    if (!threads.length) return "当前项目还没有会话。\n发送 /new 创建新会话。";
    return [
      "最近会话：",
      ...threads.map((thread, index) => `${index + 1}. ${thread.title}\n   ${thread.id}\n   状态：${thread.status}`),
    ].join("\n");
  }

  switchThread(event, selector) {
    const context = this.context(event);
    if (!context?.currentProjectId) {
      return "还没有选择项目。\n发送 /projects 查看项目，然后使用 /use <project> 切换。";
    }
    if (!selector) return "用法：/switch <thread>";
    const threads = this.store.listThreads(context.currentProjectId, 10);
    let thread = null;
    const index = Number(selector);
    if (Number.isInteger(index) && index >= 1 && index <= threads.length) {
      thread = threads[index - 1];
    } else {
      const matches = this.store.findThreadByPrefix(context.currentProjectId, selector);
      if (matches.length > 1) return `匹配到多个会话，请输入更长的 thread id 前缀。`;
      thread = matches[0] ?? null;
    }
    if (!thread) return `未找到会话：${selector}`;

    this.store.updateContext({
      adapter: event.adapter,
      externalChatId: event.chatId,
      externalUserId: event.senderId,
      currentProjectId: context.currentProjectId,
      currentThreadId: thread.id,
    });
    return [`已切换会话：${thread.title}`, `状态：${thread.status}`].join("\n");
  }

  async cancel(event) {
    const context = this.context(event);
    if (!context?.currentThreadId) {
      return "当前项目还没有选择会话。\n发送 /new 创建新会话，或 /threads 查看最近会话。";
    }
    const thread = this.store.getThread(context.currentThreadId);
    const run = this.store.getActiveRun(thread.id);
    if (!run) return "当前没有运行中的任务。";

    this.store.requestCancel(thread.id);
    const result = await this.codexDriver.cancelRun({
      threadId: thread.id,
      externalThreadId: thread.externalThreadId,
      runId: run.id,
    });
    if (result.cancelled) return "已取消当前运行。";
    return "已记录取消请求。当前 Codex Driver 暂不支持强制中断，请在桌面端确认任务状态。";
  }

  async routePrompt(event) {
    const context = this.context(event);
    if (!context?.currentProjectId) {
      return ["还没有选择项目。\n发送 /projects 查看项目，然后使用 /use <project> 切换。"];
    }
    if (!context.currentThreadId) {
      return ["当前项目还没有选择会话。\n发送 /new 创建新会话，或 /threads 查看最近会话。"];
    }

    const project = this.store.getProject(context.currentProjectId);
    const thread = this.store.getThread(context.currentThreadId);
    if (!project || !thread) return ["当前上下文已失效，请重新 /use 项目并 /new 会话。"];
    if (["running", "cancel_requested"].includes(thread.status)) {
      return ["当前会话正在运行中，请等待完成后再发送新任务，或使用 /cancel。"];
    }

    this.store.insertMessage({
      threadId: thread.id,
      source: "im",
      role: "user",
      content: event.text,
      externalMessageId: event.externalMessageId,
      createdAt: event.receivedAt || nowIso(),
    });
    const run = this.store.createRun({ threadId: thread.id, codexSessionId: thread.codexSessionId || thread.id });

    try {
      const result = await this.codexDriver.sendMessage({
        projectId: project.id,
        projectPath: project.rootPath,
        threadId: thread.id,
        externalThreadId: thread.externalThreadId,
        content: event.text,
        runId: run.id,
      });
      if (result.sessionId && result.sessionId !== thread.codexSessionId) {
        this.store.updateThread(thread.id, { codexSessionId: result.sessionId });
      }
    } catch (error) {
      this.store.finishActiveRun(thread.id, "failed");
      return ["Codex 暂时不可用。\n请确认 Codex 已安装、已登录，并且 im-coding Bridge 正在运行。"];
    }

    return [`已发送到 Codex。\n项目：${project.name}\n会话：${thread.title}\n状态：运行中`];
  }
}
