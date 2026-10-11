import { describe, expect, it } from "vitest";

import {
  AUDIT_EXPORT_SCAN_LIMIT,
  auditExportFilename,
  auditRecordsToCsv,
  auditRecordsToJson,
  buildAuditExport,
  parseAuditExportFormat,
} from "./audit-export";
import type { OperationAuditRecord } from "./operations";

const SHA = "a".repeat(40);

function record(overrides: Partial<OperationAuditRecord> = {}): OperationAuditRecord {
  return {
    idempotencyKey: "key-1",
    kind: "createBranch",
    repo: "encode-utf8/utf8-git",
    actor: "90000001",
    status: "succeeded",
    summary: "创建分支 feature/x",
    payload: { branch: "feature/x", from: SHA },
    result: { ref: "refs/heads/feature/x" },
    error: null,
    recordedAt: "2026-10-11T02:03:04.000Z",
    ...overrides,
  };
}

describe("审计导出格式解析", () => {
  it("缺省或非法值回退 CSV，大小写不敏感", () => {
    expect(parseAuditExportFormat(null)).toBe("csv");
    expect(parseAuditExportFormat(undefined)).toBe("csv");
    expect(parseAuditExportFormat("")).toBe("csv");
    expect(parseAuditExportFormat("CSV")).toBe("csv");
    expect(parseAuditExportFormat(" json ")).toBe("json");
    expect(parseAuditExportFormat("xml")).toBe("csv");
  });
});

describe("审计导出 CSV", () => {
  it("空记录只有表头，且以 CRLF 结尾", () => {
    expect(auditRecordsToCsv([])).toBe(
      "时间(UTC),仓库,操作,状态,摘要,失败原因,等价命令,结果链接,幂等键,参数(JSON)\r\n",
    );
  });

  it("每条记录一行，含等价命令与结果链接", () => {
    const csv = auditRecordsToCsv([record()]);
    const lines = csv.trimEnd().split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("创建分支,成功");
    expect(lines[1]).toContain(`git push origin ${SHA}:refs/heads/feature/x`);
    expect(lines[1]).toContain("https://github.com/encode-utf8/utf8-git/tree/feature/x");
  });

  it("逗号 / 引号 / 换行按 RFC 4180 转义", () => {
    const csv = auditRecordsToCsv([record({ summary: '标题, 带 "引号"\n第二行' })]);
    expect(csv).toContain('"标题, 带 ""引号""\n第二行"');
  });

  it("失败记录带失败原因，无链接时该列为空", () => {
    const csv = auditRecordsToCsv([
      record({
        kind: "revokeAuthorization",
        status: "failed",
        error: "上游 500",
        repo: "account/self",
      }),
    ]);
    expect(csv).toContain("撤销授权,失败");
    expect(csv).toContain("上游 500");
  });
});

describe("审计导出 JSON", () => {
  it("带导出时间与条数，条目为稳定投影（不含原始 result）", () => {
    const json = auditRecordsToJson([record()], new Date("2026-10-11T05:00:00.000Z"));
    const parsed = JSON.parse(json) as {
      exportedAt: string;
      count: number;
      operations: Record<string, unknown>[];
    };
    expect(parsed.exportedAt).toBe("2026-10-11T05:00:00.000Z");
    expect(parsed.count).toBe(1);
    expect(parsed.operations[0]).toMatchObject({
      kind: "createBranch",
      kindLabel: "创建分支",
      statusLabel: "成功",
      gitCommand: `git push origin ${SHA}:refs/heads/feature/x`,
      resultLink: {
        href: "https://github.com/encode-utf8/utf8-git/tree/feature/x",
        label: "在 GitHub 查看分支",
      },
    });
    expect(parsed.operations[0]).not.toHaveProperty("result");
  });

  it("没有结果链接时 resultLink 为 null", () => {
    const parsed = JSON.parse(
      auditRecordsToJson(
        [record({ kind: "purgeAccountData", result: null })],
        new Date("2026-10-11T05:00:00.000Z"),
      ),
    ) as { operations: { resultLink: unknown }[] };
    expect(parsed.operations[0].resultLink).toBeNull();
  });
});

describe("审计导出文件名与响应组装", () => {
  it("文件名按 UTC 日期补零", () => {
    expect(auditExportFilename("csv", new Date("2026-01-02T23:30:00.000Z"))).toBe(
      "utf8-git-audit-20260102.csv",
    );
    expect(auditExportFilename("json", new Date("2026-12-31T00:00:00.000Z"))).toBe(
      "utf8-git-audit-20261231.json",
    );
  });

  it("buildAuditExport 给出正文、Content-Type 与文件名", () => {
    const csv = buildAuditExport([record()], {
      format: "csv",
      generatedAt: new Date("2026-10-11T05:00:00.000Z"),
    });
    expect(csv.contentType).toBe("text/csv; charset=utf-8");
    expect(csv.filename).toBe("utf8-git-audit-20261011.csv");
    expect(csv.body.endsWith("\r\n")).toBe(true);

    const json = buildAuditExport([], {
      format: "json",
      generatedAt: new Date("2026-10-11T05:00:00.000Z"),
    });
    expect(json.contentType).toBe("application/json; charset=utf-8");
    expect(json.filename).toBe("utf8-git-audit-20261011.json");
    expect(JSON.parse(json.body).count).toBe(0);
  });

  it("预取上限是导出上限的 3 倍", () => {
    expect(AUDIT_EXPORT_SCAN_LIMIT).toBe(3000);
  });
});
