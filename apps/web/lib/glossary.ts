// 概念解释层（M2-6）的术语词条与展示规则。
// 解释层默认关闭，只有用户主动开启后才渲染，避免干扰熟悉 Git 的使用者。

export type GlossaryTermId = "author" | "sha" | "merge" | "pull-request" | "issue" | "lane";

/** 术语难度：basic 面向新手，deep 面向进阶阅读。 */
export type GlossaryLevel = "basic" | "deep";

export type GlossaryTerm = {
  id: GlossaryTermId;
  term: string;
  summary: string;
  detail: string;
  level: GlossaryLevel;
};

/** 解释模式：关闭 / 新手 / 进阶。 */
export type ExplainMode = "off" | "beginner" | "advanced";

export const EXPLAIN_MODES: readonly { value: ExplainMode; label: string }[] = [
  { value: "off", label: "关闭" },
  { value: "beginner", label: "新手" },
  { value: "advanced", label: "进阶" },
];

const TERMS: readonly GlossaryTerm[] = [
  {
    id: "author",
    term: "提交作者",
    summary: "写下这次改动的账号。",
    detail: "作者取自提交的 author 字段，可能与「提交者（committer）」不同，例如合并他人 PR 时。",
    level: "basic",
  },
  {
    id: "sha",
    term: "提交哈希（SHA）",
    summary: "每次提交的唯一指纹，由提交内容计算得出。",
    detail:
      "完整为 40 位十六进制，界面常显示前 7 位缩写；它永久指向这一次改动，也是分支、标签与操作记录引用的目标。",
    level: "basic",
  },
  {
    id: "merge",
    term: "合并提交（merge）",
    summary: "把两条分支的历史汇到一起的提交，会有两个及以上父提交。",
    detail: "时间线上带 merge 标记的节点通常来自一次分支合并，它的父提交分别指向被合并的双方。",
    level: "basic",
  },
  {
    id: "pull-request",
    term: "拉取请求（Pull Request）",
    summary: "请求把一条分支的改动并入另一条分支的讨论与评审流程。",
    detail:
      "PR 合并后会产生合并提交（或线性历史）；时间线上的 #编号 徽标可跳转到 GitHub 上对应的 PR。",
    level: "deep",
  },
  {
    id: "issue",
    term: "议题（Issue）",
    summary: "仓库里用于记录问题、需求或讨论的条目。",
    detail:
      "当 PR 描述里写上「fixes #123」之类关键字时，该 Issue 会与这次提交关联，并在时间线上一并展示。",
    level: "deep",
  },
  {
    id: "lane",
    term: "泳道",
    summary: "时间线左侧每条分支对应的竖直轨道。",
    detail:
      "同一泳道上的节点属于同一条历史线；出现分叉或合并时，连线会在泳道之间转移，颜色仅用于区分不同的线。",
    level: "deep",
  },
];

export const GLOSSARY_TERMS: readonly GlossaryTerm[] = TERMS;

const TERM_BY_ID = new Map<GlossaryTermId, GlossaryTerm>(TERMS.map((item) => [item.id, item]));

/** 按 id 取词条；id 由类型约束，运行时缺失视为编程错误。 */
export function termById(id: GlossaryTermId): GlossaryTerm {
  const term = TERM_BY_ID.get(id);
  if (!term) {
    throw new Error(`未知术语：${id}`);
  }
  return term;
}

/** 判断某词条在当前模式下是否展示：新手展示全部，进阶只保留进阶概念，关闭则一律不展示。 */
export function shouldExplain(term: GlossaryTerm, mode: ExplainMode): boolean {
  if (mode === "off") {
    return false;
  }
  if (mode === "beginner") {
    return true;
  }
  return term.level === "deep";
}

export function isExplainMode(value: string): value is ExplainMode {
  return EXPLAIN_MODES.some((option) => option.value === value);
}
