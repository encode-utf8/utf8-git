import { describe, expect, it } from "vitest";

import {
  REQUIRED_TABLES,
  SLOW_DATABASE_RTT_MS,
  redactConnectionInfo,
  runHealthChecks,
  type HealthReport,
} from "./health";

function makeEnv(overrides: Record<string, string> = {}): Record<string, string | undefined> {
  return {
    VERCEL: "1",
    STORE_BACKEND: "postgres",
    AUTH_SECRET: "unit-test-secret",
    AUTH_TOKEN_ENC_KEY: Buffer.alloc(32, 7).toString("base64"),
    AUTH_GITHUB_ID: "Ov23liTestOnly",
    AUTH_GITHUB_SECRET: "unit-test-github-secret",
    ...overrides,
  };
}

const healthyDeps = {
  pingDatabase: async () => {},
  listTables: async () => [...REQUIRED_TABLES],
};

function findCheck(report: HealthReport, name: string) {
  return report.checks.find((check) => check.name === name);
}

describe("runHealthChecks", () => {
  it("生产配置齐全时整体通过", async () => {
    const report = await runHealthChecks({ env: makeEnv(), ...healthyDeps });
    expect(report.ok).toBe(true);
    expect(report.storeBackend).toBe("postgres");
    expect(report.sharedStoreRequired).toBe(true);
    expect(report.checks.every((check) => check.ok)).toBe(true);
  });

  it("Serverless 下未设 STORE_BACKEND 时判失败，并指出游标链风险", async () => {
    const report = await runHealthChecks({ env: makeEnv({ STORE_BACKEND: "" }), ...healthyDeps });
    expect(report.ok).toBe(false);
    const check = findCheck(report, "store_backend");
    expect(check?.ok).toBe(false);
    expect(check?.detail).toContain("cursor_expired");
  });

  it("本地非 Serverless 场景用 memory 后端不判失败", async () => {
    const report = await runHealthChecks({
      env: makeEnv({ VERCEL: "", STORE_BACKEND: "" }),
      ...healthyDeps,
    });
    expect(report.storeBackend).toBe("memory");
    expect(report.sharedStoreRequired).toBe(false);
    expect(findCheck(report, "store_backend")?.ok).toBe(true);
  });

  it("函数与数据库跨区（数据库往返过高）时给出告警，但不判失败", async () => {
    const report = await runHealthChecks({
      env: makeEnv({ VERCEL_REGION: "iad1" }),
      listTables: healthyDeps.listTables,
      pingDatabase: async () => {
        await new Promise((resolve) => setTimeout(resolve, SLOW_DATABASE_RTT_MS + 20));
      },
    });
    expect(report.ok).toBe(true);
    expect(report.functionRegion).toBe("iad1");
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]).toContain("iad1");
    expect(report.warnings[0]).toContain("sin1");
  });

  it("数据库往返正常时无告警，未注入 region 时为 null", async () => {
    const report = await runHealthChecks({ env: makeEnv(), ...healthyDeps });
    expect(report.ok).toBe(true);
    expect(report.functionRegion).toBeNull();
    expect(report.warnings).toEqual([]);
  });

  it("缺表时列出缺失的表名", async () => {
    const report = await runHealthChecks({
      env: makeEnv(),
      pingDatabase: async () => {},
      listTables: async () => ["users", "accounts"],
    });
    const check = findCheck(report, "required_tables");
    expect(check?.ok).toBe(false);
    expect(check?.detail).toContain("sessions");
    expect(check?.detail).toContain("shared_cache_entries");
  });

  it("数据库不可达时判失败，且不泄露连接串", async () => {
    const report = await runHealthChecks({
      env: makeEnv(),
      listTables: healthyDeps.listTables,
      pingDatabase: async () => {
        throw new Error(
          "connect ECONNREFUSED postgresql://user:sup3rsecret@db.example:5432/neondb",
        );
      },
    });
    expect(report.ok).toBe(false);
    const check = findCheck(report, "database_reachable");
    expect(check?.ok).toBe(false);
    expect(check?.detail).not.toContain("sup3rsecret");
    // 连接失败时不再继续核对表结构，避免叠加误导信息
    expect(findCheck(report, "required_tables")).toBeUndefined();
  });

  it("缺少必填密钥时逐项提示", async () => {
    const report = await runHealthChecks({
      env: makeEnv({ AUTH_GITHUB_SECRET: "" }),
      ...healthyDeps,
    });
    expect(report.ok).toBe(false);
    expect(findCheck(report, "env:AUTH_GITHUB_SECRET")?.ok).toBe(false);
    expect(findCheck(report, "env:AUTH_SECRET")?.ok).toBe(true);
  });

  it("AUTH_TOKEN_ENC_KEY 长度不足 32 字节时判失败", async () => {
    const report = await runHealthChecks({
      env: makeEnv({ AUTH_TOKEN_ENC_KEY: Buffer.alloc(16, 3).toString("base64") }),
      ...healthyDeps,
    });
    const check = findCheck(report, "auth_token_enc_key_length");
    expect(check?.ok).toBe(false);
    expect(check?.detail).toContain("应为 32 字节");
  });
});

describe("redactConnectionInfo", () => {
  it("把多行错误压成一行", () => {
    expect(redactConnectionInfo("a\n\n  b ")).toBe("a b");
  });

  it("抹掉连接串", () => {
    expect(redactConnectionInfo("failed postgresql://u:p@h:5432/db now")).toBe(
      "failed postgresql://*** now",
    );
  });
});
