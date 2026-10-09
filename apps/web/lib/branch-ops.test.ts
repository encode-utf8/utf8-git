import { describe, expect, it } from "vitest";

import {
  createBranchDescriptor,
  describeCreateBranchFailure,
  validateBranchName,
} from "./branch-ops";

describe("分支名校验", () => {
  it("接受合法分支名", () => {
    for (const name of ["feature/demo", "fix-1", "release/2026.10", "a.b.c", "main"]) {
      expect(validateBranchName(name)).toBeNull();
    }
  });

  it("拒绝空名与超长名", () => {
    expect(validateBranchName("")).toContain("不能为空");
    expect(validateBranchName("a".repeat(256))).toContain("255");
  });

  it("拒绝非法字符与结构", () => {
    expect(validateBranchName("feat ure")).toContain("特殊字符");
    expect(validateBranchName("feat~1")).toContain("特殊字符");
    expect(validateBranchName("feat..x")).toContain("..");
    expect(validateBranchName("feat//x")).toContain("//");
    expect(validateBranchName("/feat")).toContain("/");
    expect(validateBranchName("feat/")).toContain("/");
    expect(validateBranchName("feat.")).toContain(".");
    expect(validateBranchName("-feat")).toContain("-");
    expect(validateBranchName("@")).toContain("@");
    expect(validateBranchName("feat@{1}")).toContain("@{");
    expect(validateBranchName("feat/.hidden")).toContain(".");
    expect(validateBranchName("feat/x.lock")).toContain(".lock");
  });
});

describe("创建分支操作描述", () => {
  it("包含仓库 / 分支 / 起点与影响预览", () => {
    const sha = "a".repeat(40);
    const descriptor = createBranchDescriptor({
      owner: "encode-utf8",
      name: "utf8-git",
      branch: "feature/demo",
      fromSha: sha,
      fromLabel: "提交 aaaaaaa",
    });
    expect(descriptor.kind).toBe("createBranch");
    expect(descriptor.summary).toBe("在 encode-utf8/utf8-git 创建分支 feature/demo");
    expect(descriptor.payload).toEqual({ branch: "feature/demo", from: sha });
    expect(descriptor.impacts[0]).toContain("提交 aaaaaaa");
    expect(descriptor.impacts[0]).toContain("feature/demo");
  });
});

describe("创建分支失败文案", () => {
  it("按错误码给出针对性提示", () => {
    expect(describeCreateBranchFailure(422, "branch_conflict")).toContain("已存在");
    expect(describeCreateBranchFailure(403, "forbidden")).toContain("权限不足");
    expect(describeCreateBranchFailure(401, "token_invalid")).toContain("重新登录");
    expect(describeCreateBranchFailure(504, "github_timeout")).toContain("超时");
  });

  it("未知错误码按状态码回退", () => {
    expect(describeCreateBranchFailure(400, "invalid_branch")).toContain("参数");
    expect(describeCreateBranchFailure(500, "internal_error")).toContain("稍后重试");
  });
});
