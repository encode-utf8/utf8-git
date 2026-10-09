import { describe, expect, it } from "vitest";

import type { TimelineCommit, TimelinePullRequest } from "./github-timeline";
import {
  EMPTY_TIMELINE_FILTER,
  filterTimelineCommits,
  hasActiveTimelineFilter,
  timelineAuthors,
  type TimelineFilterState,
} from "./timeline-filters";

function pullRequest(overrides: Partial<TimelinePullRequest> = {}): TimelinePullRequest {
  return {
    number: 1,
    title: "PR",
    state: "MERGED",
    mergedAt: null,
    url: null,
    issues: [],
    ...overrides,
  };
}

function makeCommit(overrides: Partial<TimelineCommit> = {}): TimelineCommit {
  return {
    oid: "a".repeat(40),
    headline: "feat: 默认提交",
    committedDate: "2026-10-05T00:00:00Z",
    author: { login: "alice", name: "Alice", avatarUrl: null },
    parents: [],
    pullRequests: [],
    ...overrides,
  };
}

const plain = makeCommit({ oid: "a".repeat(40), headline: "feat: 普通提交" });
const withPr = makeCommit({
  oid: "b".repeat(40),
  headline: "feat: 新增页面",
  pullRequests: [pullRequest({ number: 3 })],
});
const withIssue = makeCommit({
  oid: "c".repeat(40),
  headline: "fix: 修复空白",
  pullRequests: [
    pullRequest({
      number: 4,
      issues: [{ number: 12, title: "时间线偶发空白", state: "CLOSED", url: null }],
    }),
  ],
});
const merge = makeCommit({
  oid: "d".repeat(40),
  headline: "Merge branch 'dev'",
  parents: ["a".repeat(40), "b".repeat(40)],
});

const commits = [plain, withPr, withIssue, merge];

function state(overrides: Partial<TimelineFilterState>): TimelineFilterState {
  return { ...EMPTY_TIMELINE_FILTER, ...overrides };
}

describe("filterTimelineCommits", () => {
  it("默认不过滤，且不视为已激活", () => {
    expect(filterTimelineCommits(commits, EMPTY_TIMELINE_FILTER)).toEqual(commits);
    expect(hasActiveTimelineFilter(EMPTY_TIMELINE_FILTER)).toBe(false);
    expect(hasActiveTimelineFilter(state({ query: "  " }))).toBe(false);
    expect(hasActiveTimelineFilter(state({ kind: "merge" }))).toBe(true);
  });

  it("关键词匹配标题 / SHA / 作者（大小写不敏感）", () => {
    expect(filterTimelineCommits(commits, state({ query: "空白" })).map((c) => c.oid)).toEqual([
      withIssue.oid,
    ]);
    expect(filterTimelineCommits(commits, state({ query: "ALICE" }))).toHaveLength(4);
    expect(filterTimelineCommits(commits, state({ query: "bbbbbb" })).map((c) => c.oid)).toEqual([
      withPr.oid,
    ]);
  });

  it("作者精确匹配", () => {
    const mixed = [
      ...commits,
      makeCommit({ oid: "e".repeat(40), author: { login: "bob", name: null, avatarUrl: null } }),
    ];
    expect(filterTimelineCommits(mixed, state({ author: "bob" })).map((c) => c.oid)).toEqual([
      "e".repeat(40),
    ]);
    expect(filterTimelineCommits(mixed, state({ author: "alice" }))).toHaveLength(4);
  });

  it("事件类型：仅合并 / 仅关联 PR / 仅关联 Issue", () => {
    expect(filterTimelineCommits(commits, state({ kind: "merge" }))).toEqual([merge]);
    expect(filterTimelineCommits(commits, state({ kind: "pullRequest" }))).toEqual([
      withPr,
      withIssue,
    ]);
    expect(filterTimelineCommits(commits, state({ kind: "issue" }))).toEqual([withIssue]);
  });

  it("多个条件取交集", () => {
    expect(filterTimelineCommits(commits, state({ kind: "pullRequest", query: "空白" }))).toEqual([
      withIssue,
    ]);
    expect(filterTimelineCommits(commits, state({ kind: "merge", query: "空白" }))).toEqual([]);
  });
});

describe("timelineAuthors", () => {
  it("去重、保留首次出现顺序，忽略未知作者", () => {
    const extra = [
      makeCommit({ oid: "e".repeat(40), author: { login: "bob", name: "Bob", avatarUrl: null } }),
      makeCommit({ oid: "f".repeat(40), author: { login: null, name: null, avatarUrl: null } }),
      makeCommit({
        oid: "g".repeat(40),
        author: { login: "alice", name: "Alice", avatarUrl: null },
      }),
    ];
    expect(timelineAuthors([...commits, ...extra])).toEqual(["alice", "bob"]);
    expect(timelineAuthors([])).toEqual([]);
  });

  it("登录名缺失时回退到名称", () => {
    const named = makeCommit({
      oid: "h".repeat(40),
      author: { login: null, name: "Carol", avatarUrl: null },
    });
    expect(timelineAuthors([named])).toEqual(["Carol"]);
  });
});
