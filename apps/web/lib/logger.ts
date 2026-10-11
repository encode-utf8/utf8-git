// 结构化日志（M4-1）：一行一条 JSON，便于在 Vercel / 容器日志里按字段检索。
// 设计约束：日志绝不能反过来把请求打挂——sink 抛错一律吞掉；字段一律先脱敏。

import { redactFields } from "./redact";
import type { EnvLike } from "./shared-store";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogLevelSetting = LogLevel | "silent";

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export const DEFAULT_LOG_LEVEL: LogLevel = "info";
export const LOG_LEVEL_ENV = "LOG_LEVEL";

export type LogFields = Record<string, unknown>;
export type LogRecord = { time: string; level: LogLevel; event: string } & LogFields;
export type LogSink = (record: LogRecord) => void;
export type LogEvent = (level: LogLevel, event: string, fields?: LogFields) => void;

/** 解析日志级别：未设置 / 非法值回退 `info`；`silent`（或 off / none）关闭输出。 */
export function resolveLogLevel(raw: string | undefined): LogLevelSetting {
  const value = raw?.trim().toLowerCase();
  if (!value) {
    return DEFAULT_LOG_LEVEL;
  }
  if (value === "silent" || value === "off" || value === "none") {
    return "silent";
  }
  return value in LEVEL_WEIGHT ? (value as LogLevel) : DEFAULT_LOG_LEVEL;
}

/** 默认 sink：stdout / stderr 各写一行 JSON（error 走 stderr，其余走 stdout）。 */
export const consoleSink: LogSink = (record) => {
  const line = JSON.stringify(record);
  if (record.level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
};

export type LoggerDeps = {
  env?: EnvLike;
  sink?: LogSink;
  now?: () => Date;
};

/**
 * 创建日志函数。级别阈值在创建时定格（Serverless 每次冷启动读一次即可）；
 * 单测传 `sink` 捕获输出、传 `env` 控制级别。
 */
export function createLogEvent(deps: LoggerDeps = {}): LogEvent {
  const env = deps.env ?? process.env;
  const sink = deps.sink ?? consoleSink;
  const now = deps.now ?? (() => new Date());
  const setting = resolveLogLevel(env[LOG_LEVEL_ENV]);
  const minimum = setting === "silent" ? Number.POSITIVE_INFINITY : LEVEL_WEIGHT[setting];
  return (level, event, fields = {}) => {
    if (LEVEL_WEIGHT[level] < minimum) {
      return;
    }
    try {
      sink({ time: now().toISOString(), level, event, ...redactFields(fields) });
    } catch {
      // sink 失败不影响主流程
    }
  };
}

/** 进程级默认日志函数（各处不便注入 deps 时使用）。 */
export const logEvent: LogEvent = createLogEvent();
