import { describe, expect, it, vi } from "vitest";

import { MemoryOperationAuditStore, latestPerIdempotencyKey } from "./operation-audit";
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

  it("list 支持按操作类型与状态过滤（恢复入口只取成功的删除记录）", async () => {
    const store = new MemoryOperationAuditStore();
    await store.append(
      record({ idempotencyKey: "del-1", kind: "deleteBranch", status: "started" }),
    );
    await store.append(
      record({ idempotencyKey: "del-1", kind: "deleteBranch", status: "succeeded" }),
    );
    await store.append(record({ idempotencyKey: "del-2", kind: "deleteBranch", status: "failed" }));
    await store.append(
      record({ idempotencyKey: "create-1", kind: "createBranch", status: "succeeded" }),
    );

    const restorable = await store.list({ kind: "deleteBranch", status: "succeeded" });
    expect(restorable.map((item) => item.idempotencyKey)).toEqual(["del-1"]);
  });
});

describe("操作历史收敛", () => {
  it("同一幂等键只保留最新一条（started 被终态覆盖）", () => {
    const records = [
      record({ idempotencyKey: "k1", status: "succeeded" }),
      record({ idempotencyKey: "k1", status: "started" }),
      record({ idempotencyKey: "k2", status: "failed" }),
      record({ idempotencyKey: "k2", status: "started" }),
    ];
    const latest = latestPerIdempotencyKey(records);
    expect(latest.map((item) => `${item.idempotencyKey}:${item.status}`)).toEqual([
      "k1:succeeded",
      "k2:failed",
    ]);
  });

  it("只有 started 的记录仍然保留（进行中）", () => {
    expect(
      latestPerIdempotencyKey([record({ idempotencyKey: "k3", status: "started" })]),
    ).toHaveLength(1);
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
