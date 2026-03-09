/**
 * Auto-Logger Skill
 *
 * 自动记录所有用户输入和 AI 回复到本地 JSON Lines 文件
 * 存储路径: ~/.claude/logs/sessions/YYYY-MM-DD/{sessionId}.jsonl
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// 日志记录接口
interface LogEntry {
  timestamp: string;
  project: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// 会话信息接口
interface SessionInfo {
  sessionId: string;
  project: string;
  logFilePath: string;
}

// 全局会话信息缓存
const sessionCache = new Map<string, SessionInfo>();

/**
 * 获取当前日期的字符串格式 YYYY-MM-DD
 */
function getCurrentDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 获取 ISO 格式的时间戳
 */
function getTimestamp(): string {
  return new Date().toISOString();
}

/**
 * 获取日志目录路径
 * 路径: ~/.claude/logs/sessions/YYYY-MM-DD/
 */
function getLogDir(): string {
  const homeDir = os.homedir();
  const dateStr = getCurrentDate();
  return path.join(homeDir, '.claude', 'logs', 'sessions', dateStr);
}

/**
 * 确保日志目录存在，如果不存在则创建
 * 使用递归创建目录
 */
async function ensureLogDir(): Promise<string> {
  const logDir = getLogDir();

  try {
    // 检查目录是否存在
    await fs.promises.access(logDir, fs.constants.F_OK);
  } catch {
    // 目录不存在，递归创建
    try {
      await fs.promises.mkdir(logDir, { recursive: true, mode: 0o755 });
    } catch (error) {
      console.error(`[Auto-Logger] 无法创建日志目录: ${logDir}`, error);
      throw error;
    }
  }

  return logDir;
}

/**
 * 获取日志文件完整路径
 */
function getLogFilePath(sessionId: string): string {
  const logDir = getLogDir();
  return path.join(logDir, `${sessionId}.jsonl`);
}

/**
 * 写入日志条目到文件
 * 使用追加模式写入 JSON Lines 格式
 */
async function writeLog(entry: LogEntry): Promise<void> {
  try {
    // 确保目录存在
    await ensureLogDir();

    const logFilePath = getLogFilePath(entry.sessionId);

    // 将日志条目转换为 JSON 字符串并添加换行符
    const logLine = JSON.stringify(entry) + '\n';

    // 使用追加模式异步写入文件
    await fs.promises.writeFile(logFilePath, logLine, {
      flag: 'a',      // 追加模式
      encoding: 'utf8',
      mode: 0o644     // 文件权限: rw-r--r--
    });
  } catch (error) {
    // 记录错误但不阻塞主流程
    console.error('[Auto-Logger] 写入日志失败:', error);
  }
}

/**
 * 生成唯一的会话 ID
 * 使用当前时间戳和随机字符串组合
 */
function generateSessionId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 10);
  return `${timestamp}-${random}`;
}

/**
 * 获取或创建会话信息
 */
function getSessionInfo(context: any): SessionInfo {
  // 尝试从上下文中获取会话 ID
  const sessionId = context?.session?.id || generateSessionId();

  // 检查缓存
  if (sessionCache.has(sessionId)) {
    return sessionCache.get(sessionId)!;
  }

  // 创建新的会话信息
  const project = context?.project?.name || context?.workspace?.name || 'unknown';
  const logFilePath = getLogFilePath(sessionId);

  const sessionInfo: SessionInfo = {
    sessionId,
    project,
    logFilePath
  };

  // 缓存会话信息
  sessionCache.set(sessionId, sessionInfo);

  return sessionInfo;
}

/**
 * 会话开始时的处理函数
 * 初始化日志文件并记录会话开始事件
 */
export async function onSessionStart(context: any): Promise<void> {
  const sessionInfo = getSessionInfo(context);

  // 创建系统日志条目，标记会话开始
  const entry: LogEntry = {
    timestamp: getTimestamp(),
    project: sessionInfo.project,
    sessionId: sessionInfo.sessionId,
    role: 'system',
    content: 'Session started'
  };

  await writeLog(entry);

  console.log(`[Auto-Logger] 会话日志已初始化: ${sessionInfo.logFilePath}`);
}

/**
 * 用户消息处理函数
 * 记录用户输入到日志文件
 */
export async function onUserMessage(message: string, context: any): Promise<void> {
  const sessionInfo = getSessionInfo(context);

  const entry: LogEntry = {
    timestamp: getTimestamp(),
    project: sessionInfo.project,
    sessionId: sessionInfo.sessionId,
    role: 'user',
    content: message
  };

  // 异步写入，不阻塞主流程
  writeLog(entry).catch(error => {
    console.error('[Auto-Logger] 记录用户消息失败:', error);
  });
}

/**
 * AI 回复处理函数
 * 记录 AI 回复到日志文件
 */
export async function onAssistantMessage(message: string, context: any): Promise<void> {
  const sessionInfo = getSessionInfo(context);

  const entry: LogEntry = {
    timestamp: getTimestamp(),
    project: sessionInfo.project,
    sessionId: sessionInfo.sessionId,
    role: 'assistant',
    content: message
  };

  // 异步写入，不阻塞主流程
  writeLog(entry).catch(error => {
    console.error('[Auto-Logger] 记录 AI 回复失败:', error);
  });
}

/**
 * 清理过期的会话缓存
 * 防止内存泄漏
 */
function cleanupSessionCache(): void {
  // 限制缓存大小，保留最近的 100 个会话
  const maxCacheSize = 100;

  if (sessionCache.size > maxCacheSize) {
    const entriesToDelete = sessionCache.size - maxCacheSize;
    const keys = sessionCache.keys();

    for (let i = 0; i < entriesToDelete; i++) {
      const key = keys.next().value;
      if (key) {
        sessionCache.delete(key);
      }
    }
  }
}

// 定期清理缓存（每 30 分钟）
setInterval(cleanupSessionCache, 30 * 60 * 1000);

// 导出默认对象，供 Skill 系统加载
export default {
  name: 'auto-logger',
  version: '1.0.0',
  onSessionStart,
  onUserMessage,
  onAssistantMessage
};
