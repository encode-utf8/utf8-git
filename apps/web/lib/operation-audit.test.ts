import { describe, expect, it, vi } from "vitest";

import { MemoryOperationAuditStore } from "./operation-audit";
import {
  createIdempotencyKey,
  runOperation,
  type OperationAuditRecord,
  type OperationDescriptor,
} from "./operations";

function record(overrides: Partial<OperationAuditRecord> = {}): OperationAuditRecord {
  return {
    idempotencyKey: "k1",
    kind: "createBranch",
    repo: "encode-utf8/utf8-git",
    actor: "u1",
    status: "started",
    summary: "基于 main 创建 feature/demo 分支",
    payload: { branch: "feature/demo" },
    result: null,
    error: null,
    recordedAt: "2026-10-09T00:00:00.000Z",
    ...overrides,
  };
}

function descriptor(): OperationDescriptor {
  return {
    kind: "createBranch",
    repo: { owner: "encode-utf8", name: "utf8-git" },
    summary: "基于 main 创建 feature/demo 分支",
    impacts: ["新增分支 feature/demo"],
    payload: { branch: "feature/demo", from: "main" },
  };
}

describe("内存审计存储", () => {
  it("find 返回该幂等键最近写入的一条", async () => {
    const store = new MemoryOperationAuditStore();
    await store.append(record({ idempotencyKey: "k1", status: "started" }));
    await store.append(record({ idempotencyKey: "k1", status: "succeeded" }));
    await store.append(record({ idempotencyKey: "k2", status: "failed", actor: "u2" }));

    expect((await store.find("k1"))?.status).toBe("succeeded");
    expect((await store.find("k2"))?.actor).toBe("u2");
    expect(await store.find("missing")).toBeNull();
  });

  it("list 最新优先，支持 repo / actor 过滤与 limit", async () => {
    const store = new MemoryOperationAuditStore();
    await store.append(record({ idempotencyKey: "a", status: "started" }));
    await store.append(record({ idempotencyKey: "b", status: "succeeded" }));
    await store.append(record({ idempotencyKey: "c", status: "started", repo: "other/repo" }));
    await store.append(record({ idempotencyKey: "d", status: "started", actor: "u2" }));

    expect((await store.list()).map((item) => item.idempotencyKey)).toEqual(["d", "c", "b", "a"]);
    expect(
      (await store.list({ repo: "encode-utf8/utf8-git" })).map((item) => item.idempotencyKey),
    ).toEqual(["d", "b", "a"]);
    expect((await store.list({ actor: "u2" })).map((item) => item.idempotencyKey)).toEqual(["d"]);
    expect((await store.list({ limit: 2 })).map((item) => item.idempotencyKey)).toEqual(["d", "c"]);
  });
});

describe("管线 + 审计存储联调", () => {
  it("成功后同键重放不再执行，审计保留两条", async () => {
    const store = new MemoryOperationAuditStore();
    const key = createIdempotencyKey(descriptor(), "u1");
    const execute = vi.fn(async () => ({ ref: "refs/heads/feature/demo" }));

    const first = await runOperation({
      descriptor: descriptor(),
      actor: "u1",
      idempotencyKey: key,
      confirmed: true,
      execute,
      audit: store,
    });
    const second = await runOperation({
      descriptor: descriptor(),
      actor: "u1",
      idempotencyKey: key,
      confirmed: true,
      execute,
      audit: store,
    });

    expect(first.status).toBe("succeeded");
    expect(second).toEqual({ status: "replayed", value: { ref: "refs/heads/feature/demo" } });
    expect(execute).toHaveBeenCalledTimes(1);
    const rows = await store.list();
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.status)).toEqual(["succeeded", "started"]);
  });
});
