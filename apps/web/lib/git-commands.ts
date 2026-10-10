// M3-7 操作历史：把审计记录翻译成「等价 Git / gh 命令」与结果链接（纯逻辑，无 IO）。
// 命令仅用于展示与复制，本应用不会去执行它；git 命令统一假设 origin 指向该仓库。

import type { OperationKind } from "./operations";

export type ResultLink = { href: string; label: string };
export type OperationPayload = Record<string, string>;

function quote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** 从执行结果里读一个字符串 / 数字字段（结果是执行器的返回值，形状随操作而异）。 */
function resultField(result: unknown, key: string): string | null {
  if (typeof result !== "object" || result === null) {
    return null;
  }
  const value = (result as Record<string, unknown>)[key];
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

/**
 * 生成与本次操作等价的 Git / gh 命令，帮助用户理解「界面上的一次点击」在命令行里的写法。
 * 仓库地址由调用方以 `owner/name` 传入；git 命令用 `origin` 指代该仓库。
 */
export function operationGitCommand(
  kind: OperationKind,
  repo: string,
  payload: OperationPayload,
): string {
  switch (kind) {
    case "createBranch":
    case "restoreBranch":
      return `git push origin ${payload.from}:refs/heads/${payload.branch}`;
    case "deleteBranch":
      return `git push origin --delete ${payload.branch}`;
    case "createIssue": {
      const parts = [`gh issue create --repo ${repo}`, `--title ${quote(payload.title ?? "")}`];
      if (payload.body) {
        parts.push(`--body ${quote(payload.body)}`);
      }
      for (const label of (payload.labels ?? "").split(",").filter(Boolean)) {
        parts.push(`--label ${quote(label)}`);
      }
      return parts.join(" ");
    }
    case "createPullRequest": {
      const parts = [
        `gh pr create --repo ${repo}`,
        `--base ${payload.base}`,
        `--head ${payload.head}`,
        `--title ${quote(payload.title ?? "")}`,
      ];
      if (payload.body) {
        parts.push(`--body ${quote(payload.body)}`);
      }
      if (payload.draft === "true") {
        parts.push("--draft");
      }
      return parts.join(" ");
    }
    case "mergePullRequest":
      return `gh pr merge ${payload.number} --repo ${repo} --${payload.method ?? "merge"}`;
    default:
      return "";
  }
}

/** 结果链接：分支类操作指向 GitHub 网页，Issue / PR 优先用上游返回的 html 地址。 */
export function operationResultLink(
  kind: OperationKind,
  repo: string,
  payload: OperationPayload,
  result: unknown,
): ResultLink | null {
  switch (kind) {
    case "createBranch":
    case "restoreBranch":
      return payload.branch
        ? { href: `https://github.com/${repo}/tree/${payload.branch}`, label: "在 GitHub 查看分支" }
        : null;
    case "createIssue": {
      const url = resultField(result, "url");
      const number = resultField(result, "number");
      return url ? { href: url, label: number ? `查看 Issue #${number}` : "查看 Issue" } : null;
    }
    case "createPullRequest": {
      const url = resultField(result, "url");
      const number = resultField(result, "number");
      return url ? { href: url, label: number ? `查看 PR #${number}` : "查看 PR" } : null;
    }
    case "mergePullRequest":
      return payload.number
        ? {
            href: `https://github.com/${repo}/pull/${payload.number}`,
            label: `查看 PR #${payload.number}`,
          }
        : null;
    case "deleteBranch":
      return { href: `https://github.com/${repo}/branches`, label: "查看分支列表" };
    default:
      return null;
  }
}
