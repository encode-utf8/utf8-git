import { describe, expect, it } from "vitest";

import {
  createIssueDescriptor,
  describeCreateIssueFailure,
  parseIssueLabels,
  validateIssueLabels,
  validateIssueTitle,
} from "./issue-ops";

describe("Issue 字段校验", () => {
  it("标题必填且有长度上限", () => {
    expect(validateIssueTitle("")).toContain("不能为空");
    expect(validateIssueTitle("   ")).toContain("不能为空");
    expect(validateIssueTitle("a".repeat(257))).toContain("256");
    expect(validateIssueTitle("修复时间线排序")).toBeNull();
  });

  it("标签按逗号切分并去空", () => {
    expect(parseIssueLabels("bug, ui ,, feature ")).toEqual(["bug", "ui", "feature"]);
    expect(parseIssueLabels("   ")).toEqual([]);
  });

  it("标签数量与长度受限、不得含换行", () => {
    expect(validateIssueLabels(Array.from({ length: 11 }, (_, i) => `l${i}`))).toContain("最多");
    expect(validateIssueLabels(["a".repeat(51)])).toContain("50");
    expect(validateIssueLabels(["a\nb"])).toContain("换行");
    expect(validateIssueLabels(["bug", "ui"])).toBeNull();
  });
});

describe("创建 Issue 操作描述", () => {
  it("包含标题 / 标签与影响预览", () => {
    const descriptor = createIssueDescriptor({
      owner: "encode-utf8",
      name: "utf8-git",
      title: "  时间线排序异常  ",
      body: "步骤：\n1. 打开",
      labels: ["bug", "ui"],
    });
    expect(descriptor.kind).toBe("createIssue");
    expect(descriptor.summary).toBe("在 encode-utf8/utf8-git 创建 Issue：时间线排序异常");
    expect(descriptor.payload).toEqual({
      title: "时间线排序异常",
      body: "步骤：\n1. 打开",
      labels: "bug,ui",
    });
    expect(descriptor.impacts[0]).toContain("时间线排序异常");
    expect(descriptor.impacts[1]).toContain("bug、ui");
  });

  it("无标签时给出「不添加标签」", () => {
    const descriptor = createIssueDescriptor({
      owner: "o",
      name: "n",
      title: "t",
      body: "",
      labels: [],
    });
    expect(descriptor.impacts[1]).toBe("不添加标签");
  });
});

describe("创建 Issue 失败文案", () => {
  it("冲突错误使用 Issue 专用文案", () => {
    expect(describeCreateIssueFailure(422, "issue_invalid")).toContain("Issue");
    expect(describeCreateIssueFailure(403, "forbidden")).toContain("权限不足");
    expect(describeCreateIssueFailure(503, "github_unreachable")).toContain("网络");
  });
});
