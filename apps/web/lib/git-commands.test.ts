import { describe, expect, it } from "vitest";

import { operationGitCommand, operationResultLink } from "./git-commands";

const REPO = "encode-utf8/utf8-git";

describe("等价 Git / gh 命令", () => {
  it("分支类操作给出 git push 命令", () => {
    expect(
      operationGitCommand("createBranch", REPO, { branch: "feature/x", from: "a".repeat(40) }),
    ).toBe(`git push origin ${"a".repeat(40)}:refs/heads/feature/x`);
    expect(
      operationGitCommand("restoreBranch", REPO, { branch: "feature/x", from: "abc1234" }),
    ).toBe("git push origin abc1234:refs/heads/feature/x");
    expect(operationGitCommand("deleteBranch", REPO, { branch: "feature/x" })).toBe(
      "git push origin --delete feature/x",
    );
  });

  it("创建 Issue：标题 / 正文 / 标签都可复制且带引号", () => {
    expect(
      operationGitCommand("createIssue", REPO, {
        title: "时间线排序异常",
        body: "## 步骤\n\n- 打开页面",
        labels: "bug,ui",
      }),
    ).toBe(
      "gh issue create --repo encode-utf8/utf8-git --title '时间线排序异常' " +
        "--body '## 步骤\n\n- 打开页面' --label 'bug' --label 'ui'",
    );
    // 正文为空时不带 --body
    expect(operationGitCommand("createIssue", REPO, { title: "空的", body: "", labels: "" })).toBe(
      "gh issue create --repo encode-utf8/utf8-git --title '空的'",
    );
  });

  it("创建 PR：草稿带上 --draft，正文为空不带 --body", () => {
    expect(
      operationGitCommand("createPullRequest", REPO, {
        head: "feature/x",
        base: "main",
        title: "feat: 合并时间线",
        body: "",
        draft: "true",
      }),
    ).toBe(
      "gh pr create --repo encode-utf8/utf8-git --base main --head feature/x " +
        "--title 'feat: 合并时间线' --draft",
    );
  });

  it("合并 PR：按合并方式生成 gh pr merge", () => {
    expect(operationGitCommand("mergePullRequest", REPO, { number: "61", method: "squash" })).toBe(
      "gh pr merge 61 --repo encode-utf8/utf8-git --squash",
    );
    expect(operationGitCommand("mergePullRequest", REPO, { number: "61" })).toContain("--merge");
  });

  it("单引号会被安全转义", () => {
    expect(operationGitCommand("createIssue", REPO, { title: "it's broken" })).toContain(
      `'it'\\''s broken'`,
    );
  });
});

describe("结果链接", () => {
  it("分支类操作指向 GitHub 分支页", () => {
    expect(operationResultLink("createBranch", REPO, { branch: "feature/x" }, null)).toEqual({
      href: "https://github.com/encode-utf8/utf8-git/tree/feature/x",
      label: "在 GitHub 查看分支",
    });
    expect(operationResultLink("deleteBranch", REPO, { branch: "gone" }, null)).toEqual({
      href: "https://github.com/encode-utf8/utf8-git/branches",
      label: "查看分支列表",
    });
  });

  it("Issue / PR 用上游返回的地址与编号", () => {
    expect(
      operationResultLink("createIssue", REPO, {}, { number: 101, url: "https://x/issues/101" }),
    ).toEqual({ href: "https://x/issues/101", label: "查看 Issue #101" });
    expect(
      operationResultLink(
        "createPullRequest",
        REPO,
        {},
        {
          number: 61,
          url: "https://x/pull/61",
        },
      ),
    ).toEqual({ href: "https://x/pull/61", label: "查看 PR #61" });
    // 失败记录没有 result → 不给链接
    expect(operationResultLink("createIssue", REPO, {}, null)).toBeNull();
  });

  it("合并 PR 用 payload 里的编号拼链接", () => {
    expect(
      operationResultLink("mergePullRequest", REPO, { number: "61" }, { merged: true }),
    ).toEqual({
      href: "https://github.com/encode-utf8/utf8-git/pull/61",
      label: "查看 PR #61",
    });
  });
});
