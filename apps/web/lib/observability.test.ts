import { describe, expect, it, vi } from "vitest";

import { createLogEvent, type LogRecord } from "./logger";
import {
  ERROR_REPORT_ENDPOINT_ENV,
  REQUEST_ID_HEADER,
  createReportError,
  describeError,
  normalizeRequestId,
  resolveRequestId,
  withObservability,
} from "./observability";

function captureLog() {
  const records: LogRecord[] = [];
  const log = createLogEvent({ env: {}, sink: (record) => records.push(record) });
  return { records, log };
}

function makeRequest(
  headers: Record<string, string> = {},
  url = "https://example.com/api/repos?token=secret",
) {
  return new Request(url, { headers });
}

describe("resolveRequestId", () => {
  it("复用合规的 x-request-id；缺失时生成 UUID", () => {
    expect(resolveRequestId(makeRequest({ [REQUEST_ID_HEADER]: "abc-123" }))).toBe("abc-123");
    const generated = resolveRequestId(makeRequest());
    expect(normalizeRequestId(generated)).toBe(generated);
    expect(generated).toHaveLength(36);
  });

  it("丢弃不合规的输入", () => {
    expect(normalizeRequestId("has space")).toBeNull();
    expect(normalizeRequestId("")).toBeNull();
    expect(normalizeRequestId(undefined)).toBeNull();
  });
});

describe("describeError", () => {
  it("抹除消息里的连接串", () => {
    const described = describeError(new Error("connect postgresql://u:secret@h/db refused"));
    expect(described.name).toBe("Error");
    expect(described.message).not.toContain("secret");
  });

  it("非 Error 抛出物也能描述", () => {
    expect(describeError("boom").message).toBe("boom");
  });
});

describe("createReportError", () => {
  it("未配置端点时只落日志、不发请求", async () => {
    const { records, log } = captureLog();
    const fetchImpl = vi.fn();
    const report = createReportError({
      env: {},
      log,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await report(new Error("x"), { route: "repos.list" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(records[0].event).toBe("unhandled_error");
    expect(records[0].route).toBe("repos.list");
  });

  it("配置端点时 POST 结构化内容", async () => {
    const { log } = captureLog();
    const fetchImpl = vi.fn<
      (input: string | URL | Request, init?: RequestInit) => Promise<Response>
    >(async () => new Response("", { status: 202 }));
    const report = createReportError({
      env: { [ERROR_REPORT_ENDPOINT_ENV]: "https://collector.test/errors" },
      log,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await report(new Error("boom"), { route: "repos.list" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe("https://collector.test/errors");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      route: "repos.list",
      error: { message: "boom" },
    });
  });

  it("上报失败只记一条 warn，不抛出", async () => {
    const { records, log } = captureLog();
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });
    const report = createReportError({
      env: { [ERROR_REPORT_ENDPOINT_ENV]: "https://collector.test/errors" },
      log,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(report(new Error("boom"))).resolves.toBeUndefined();
    expect(records.map((record) => record.event)).toContain("error_report_failed");
  });
});

describe("withObservability", () => {
  it("记录状态码与耗时，并把 request id 写进响应头", async () => {
    const { records, log } = captureLog();
    let clock = 0;
    const handler = withObservability(
      "repos.list",
      async () => new Response("ok", { status: 200 }),
      {
        log,
        report: async () => {},
        now: () => (clock += 5),
      },
    );
    const response = await handler(makeRequest());
    expect(response.status).toBe(200);
    expect(response.headers.get(REQUEST_ID_HEADER)).toHaveLength(36);
    expect(records[0]).toMatchObject({
      event: "http_request",
      route: "repos.list",
      status: 200,
      durationMs: 5,
      path: "/api/repos",
    });
  });

  it("处理函数抛错时返回 500 并上报原始错误", async () => {
    const { records, log } = captureLog();
    const report = vi.fn(async () => {});
    const handler = withObservability(
      "repos.list",
      async () => {
        throw new Error("boom");
      },
      { log, report },
    );
    const response = await handler(makeRequest());
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "internal_error" });
    expect(report).toHaveBeenCalledTimes(1);
    expect(records[0]).toMatchObject({ level: "error", status: 500 });
  });

  it("处理函数返回 5xx 时也上报，但不改变响应", async () => {
    const { log } = captureLog();
    const report = vi.fn(async () => {});
    const handler = withObservability(
      "repos.list",
      async () => new Response("nope", { status: 503 }),
      {
        log,
        report,
      },
    );
    const response = await handler(makeRequest());
    expect(response.status).toBe(503);
    await expect(response.text()).resolves.toBe("nope");
    expect(report).toHaveBeenCalledTimes(1);
  });
});
