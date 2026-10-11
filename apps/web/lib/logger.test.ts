import { describe, expect, it } from "vitest";

import { createLogEvent, resolveLogLevel, type LogRecord } from "./logger";

const GITHUB_TOKEN = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function captureLog(env: Record<string, string> = {}) {
  const records: LogRecord[] = [];
  const log = createLogEvent({ env, sink: (record) => records.push(record) });
  return { records, log };
}

describe("resolveLogLevel", () => {
  it("默认 info；silent / off / none 关闭；非法值回退 info", () => {
    expect(resolveLogLevel(undefined)).toBe("info");
    expect(resolveLogLevel(" DEBUG ")).toBe("debug");
    expect(resolveLogLevel("silent")).toBe("silent");
    expect(resolveLogLevel("none")).toBe("silent");
    expect(resolveLogLevel("loud")).toBe("info");
  });
});

describe("createLogEvent", () => {
  it("按级别过滤，输出为带时间戳的 JSON 记录", () => {
    const { records, log } = captureLog();
    log("debug", "skipped");
    log("info", "http_request", { status: 200 });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ level: "info", event: "http_request", status: 200 });
    expect(typeof records[0].time).toBe("string");
  });

  it("LOG_LEVEL=debug 时 debug 也写出；silent 时全部丢弃", () => {
    const verbose = captureLog({ LOG_LEVEL: "debug" });
    verbose.log("debug", "kept");
    expect(verbose.records).toHaveLength(1);

    const silent = captureLog({ LOG_LEVEL: "silent" });
    silent.log("error", "dropped");
    expect(silent.records).toHaveLength(0);
  });

  it("字段先脱敏再落盘", () => {
    const { records, log } = captureLog();
    log("error", "unhandled_error", {
      accessToken: GITHUB_TOKEN,
      message: "connect postgresql://u:secret@h/db failed",
    });
    expect(records[0].accessToken).toBe("[redacted]");
    expect(String(records[0].message)).not.toContain("secret");
  });

  it("sink 抛错不会把调用方打挂", () => {
    const log = createLogEvent({
      env: {},
      sink: () => {
        throw new Error("sink down");
      },
    });
    expect(() => log("error", "unhandled_error")).not.toThrow();
  });
});
