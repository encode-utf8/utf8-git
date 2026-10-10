import { describe, expect, it } from "vitest";

import {
  ACCOUNT_SCOPE,
  createPurgeAccountDataDescriptor,
  createRevokeAuthorizationDescriptor,
  describePurgeDataFailure,
  describeRevokeAuthorizationFailure,
} from "./account-ops";
import { confirmationView, createIdempotencyKey } from "./operations";

describe("账号级操作描述", () => {
  it("撤销授权：危险操作，说明会结束会话但保留审计", () => {
    const descriptor = createRevokeAuthorizationDescriptor();
    const view = confirmationView(descriptor);

    expect(descriptor.kind).toBe("revokeAuthorization");
    expect(descriptor.repo).toEqual(ACCOUNT_SCOPE);
    expect(view.danger).toBe(true);
    expect(view.confirmLabel).toBe("撤销授权");
    const impacts = view.impacts.join("\n");
    expect(impacts).toContain("撤销本应用的访问令牌");
    expect(impacts).toContain("保留已有的写操作审计记录");
  });

  it("清除数据：影响预览带上审计条数，并说明不影响 GitHub 上的内容", () => {
    const descriptor = createPurgeAccountDataDescriptor({ auditRecords: 12 });
    const view = confirmationView(descriptor);

    expect(descriptor.kind).toBe("purgeAccountData");
    expect(view.danger).toBe(true);
    expect(view.confirmLabel).toBe("清除数据");
    const impacts = view.impacts.join("\n");
    expect(impacts).toContain("12 条");
    expect(impacts).toContain("不会影响 GitHub 上的仓库");
  });

  it("审计条数为负数 / 小数时归一化为非负整数", () => {
    expect(createPurgeAccountDataDescriptor({ auditRecords: -3 }).payload.records).toBe("0");
    expect(createPurgeAccountDataDescriptor({ auditRecords: 2.7 }).payload.records).toBe("2");
  });

  it("审计条数进入 payload：两次清除的幂等键不同", () => {
    const first = createIdempotencyKey(createPurgeAccountDataDescriptor({ auditRecords: 1 }), "u1");
    const second = createIdempotencyKey(
      createPurgeAccountDataDescriptor({ auditRecords: 2 }),
      "u1",
    );

    expect(first).not.toBe(second);
  });

  it("失败文案：限流与未配置凭据都有明确说法", () => {
    expect(describeRevokeAuthorizationFailure(429, "rate_limited")).toContain("过于频繁");
    expect(describeRevokeAuthorizationFailure(503, "revoke_unavailable")).toContain("GitHub 设置");
    expect(describePurgeDataFailure(422, "purge_failed")).toContain("数据清除未完成");
    expect(describePurgeDataFailure(503, "github_unreachable")).toContain("无法连接 GitHub");
    expect(describePurgeDataFailure(400, undefined)).toContain("请求参数有误");
  });
});
