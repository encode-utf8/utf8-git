import { describe, expect, it, vi } from "vitest";

import {
  OperationError,
  confirmationView,
  createIdempotencyKey,
  repositorySlug,
  runOperation,
  type OperationAuditRecord,
  type OperationAuditSink,
  type OperationDescriptor,
} from "./operations";

function memorySink(seed: OperationAuditRecord[] = []) {
  const records: OperationAuditRecord[] = [...seed];
  const sink: OperationAuditSink = {
    find: async (key) => records.find((record) => record.idempotencyKey === key) ?? null,
    append: async (record) => {
      records.push(record);
    },
  };
  return { sink, records };
}

function descriptor(overrides: Partial<OperationDescriptor> = {}): OperationDescriptor {
  return {
    kind: "createBranch",
    repo: { owner: "encode-utf8", name: "utf8-git" },
    summary: "基于 main 创建 feature/demo 分支",
    impacts: ["新增分支 feature/demo"],
    payload: { branch: "feature/demo", from: "main" },
    ...overrides,
  };
}

describe("确认视图", () => {
  it("删除分支标记为危险操作并给出按钮文案", () => {
    const view = confirmationView(
      descriptor({ kind: "deleteBranch", summary: "删除分支 feature/demo" }),
    );
    expect(view.danger).toBe(true);
    expect(view.confirmLabel).toBe("删除分支");
    expect(view.title).toContain("feature/demo");
  });

  it("创建类操作不算危险操作", () => {
    expect(confirmationView(descriptor({ kind: "createBranch" })).danger).toBe(false);
    expect(confirmationView(descriptor({ kind: "createIssue" })).confirmLabel).toBe("创建 Issue");
    expect(confirmationView(descriptor({ kind: "createPullRequest" })).confirmLabel).toBe(
      "创建 PR",
    );
    expect(confirmationView(descriptor({ kind: "mergePullRequest" })).confirmLabel).toBe("合并 PR");
  });

  it("仓库标识拼接为 owner/name", () => {
    expect(repositorySlug({ owner: "a", name: "b" })).toBe("a/b");
  });
});

describe("幂等键", () => {
  it("与参数书写顺序无关，但随 actor / 类型 / 仓库 / 参数变化", () => {
    const base = createIdempotencyKey(descriptor(), "u1");
    const reordered = createIdempotencyKey(
      descriptor({ payload: { from: "main", branch: "feature/demo" } }),
      "u1",
    );
    expect(reordered).toBe(base);
    expect(createIdempotencyKey(descriptor(), "u2")).not.toBe(base);
    expect(createIdempotencyKey(descriptor({ kind: "createIssue" }), "u1")).not.toBe(base);
    expect(base).toContain("encode-utf8/utf8-git");
  });
});

describe("写操作管线", () => {
  it("未确认时拒绝执行，且不写审计", async () => {
    const { sink, records } = memorySink();
    const execute = vi.fn(async () => ({ ok: true }));
    const promise = runOperation({
      descriptor: descriptor(),
      actor: "u1",
      idempotencyKey: "k1",
      confirmed: false,
      execute,
      audit: sink,
    });
    await expect(promise).rejects.toMatchObject({ code: "confirmation_required" });
    expect(execute).not.toHaveBeenCalled();
    expect(records).toHaveLength(0);
  });

  it("成功路径写 started → succeeded 并返回结果", async () => {
    const { sink, records } = memorySink();
    const outcome = await runOperation({
      descriptor: descriptor(),
      actor: "u1",
      idempotencyKey: "k1",
      confirmed: true,
      execute: async () => ({ ref: "refs/heads/feature/demo" }),
      audit: sink,
      now: () => new Date("2026-10-09T00:00:00.000Z"),
    });
    expect(outcome).toEqual({ status: "succeeded", value: { ref: "refs/heads/feature/demo" } });
    expect(records.map((record) => record.status)).toEqual(["started", "succeeded"]);
    expect(records[1].result).toEqual({ ref: "refs/heads/feature/demo" });
    expect(records[0].recordedAt).toBe("2026-10-09T00:00:00.000Z");
  });

  it("失败时写 failed 审计并抛出 execution_failed，携带原因", async () => {
    const { sink, records } = memorySink();
    const promise = runOperation({
      descriptor: descriptor(),
      actor: "u1",
      idempotencyKey: "k1",
      confirmed: true,
      execute: async () => {
        throw new Error("分支已存在");
      },
      audit: sink,
    });
    await expect(promise).rejects.toBeInstanceOf(OperationError);
    await expect(promise).rejects.toMatchObject({ code: "execution_failed", detail: "分支已存在" });
    expect(records.map((record) => record.status)).toEqual(["started", "failed"]);
    expect(records[1].error).toBe("分支已存在");
  });

  it("幂等键命中已成功记录时直接回放，不再执行", async () => {
    const seed: OperationAuditRecord[] = [
      {
        idempotencyKey: "k1",
        kind: "createBranch",
        repo: "encode-utf8/utf8-git",
        actor: "u1",
        status: "succeeded",
        summary: "基于 main 创建 feature/demo 分支",
        payload: { branch: "feature/demo", from: "main" },
        result: { ref: "refs/heads/feature/demo" },
        error: null,
        recordedAt: "2026-10-09T00:00:00.000Z",
      },
    ];
    const { sink, records } = memorySink(seed);
    const execute = vi.fn(async () => ({ ref: "should-not-run" }));
    const outcome = await runOperation({
      descriptor: descriptor(),
      actor: "u1",
      idempotencyKey: "k1",
      confirmed: true,
      execute,
      audit: sink,
    });
    expect(outcome).toEqual({ status: "replayed", value: { ref: "refs/heads/feature/demo" } });
    expect(execute).not.toHaveBeenCalled();
    expect(records).toHaveLength(1);
  });
});
