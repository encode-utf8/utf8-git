# M2 只读增强 · 阶段性复盘

> 关联：`docs/roadmap.md` §4（M2）· `docs/todo.md` §3.2 · `docs/development-log.md`（M2-1 ~ M2-6）
> 复盘时间：2026-10-09（M2 全部任务落地后）
> 结论：**六个任务全部落地，退出标准达成** —— 时间线从「提交列表」升级为「分支故事」。

## 1. 交付清单

| 编号 | 任务            | 主要产出                                                                                                                  | 验证                                                              |
| ---- | --------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| M2-1 | 泳道布局算法    | `packages/git-graph/src/layout.ts`（`computeLaneLayout`）+ `layout.test.ts`                                               | merge / octopus / root / 多独立根 / rebase / 分页截断用例         |
| M2-2 | 分支泳道渲染    | `sliceLaneLayout` + `synthetic-history.ts` + `layout.perf.test.ts`；`apps/web/.../lane-graph.tsx`、`lib/lane-geometry.ts` | 50×100=5051 提交基准；E2E 断言图层随窗口渲染                      |
| M2-3 | PR / Issue 标注 | GraphQL 聚合 `closingIssuesReferences`，事件挂载到关联提交                                                                | E2E：`#60 已合并` 跳 `/pull/60`、`#1060 已关闭` 跳 `/issues/1060` |
| M2-4 | 过滤与搜索      | `lib/timeline-filters.ts` + 筛选栏（关键词 / 作者 / 事件类型）                                                            | E2E：关键词 1/60、事件类型 PR 6/60，实时计数                      |
| M2-5 | 时间缩放        | `range` 过滤维度 + `indexOfCommit` 重锚定                                                                                 | E2E：近一周 3/60、近一月 10/60，切换后详情面板仍在                |
| M2-6 | 概念解释层      | `lib/glossary.ts` + `glossary-hint.tsx` + 关闭 / 新手 / 进阶模式                                                          | E2E：默认关闭、新手弹出卡片、进阶隐藏基础术语                     |

## 2. 退出标准核对

路线图退出标准：**能在一个屏幕上讲清「这个仓库最近发生了什么」；用户可复盘一次完整的分支生命周期。**

| 标准                            | 状态            | 证据                                                                                           |
| ------------------------------- | --------------- | ---------------------------------------------------------------------------------------------- |
| 一屏讲清最近发生了什么          | ✅ 达成         | 泳道图 + 行内 PR / Issue 标注 + 关键词 / 作者 / 事件类型过滤 + 近一周 / 一月缩放，均在单页完成 |
| 复盘一次完整分支生命周期        | ✅ 达成（只读） | 泳道图呈现 fork / merge 连线；合成历史覆盖 50 分支并发；交互式「改历史」留待 M3                |
| 性能：50 分支 / 5000 提交可交互 | ✅ 达成         | 全量布局 ≈11ms、窗口切片 ≈0.4ms；切片元素量只与窗口大小相关（`layout.perf.test.ts` 护栏）      |

## 3. 质量与工程证据

- 单测：`apps/web` 174 passed（含 `timeline-filters` / `glossary` / `lane-geometry` 等）；`packages/git-graph` 布局与性能护栏；根目录 `pnpm test` 全绿。
- E2E：`timeline.spec.ts`（3）+ `auth.spec.ts`（2）共 5 条；CI `e2e` job（postgres:16 + Playwright chromium）全绿。
- CI：`verify`（lint / typecheck / test / build）+ `e2e` 双 job；M2-6 收尾 run `37919572235`（sha `5ac25fa`）双绿。
- 可测性：上游地址支持 `GITHUB_API_BASE_URL` / `GITHUB_GRAPHQL_ENDPOINT` / `GITHUB_TOKEN_ENDPOINT` 覆盖，E2E 用 mock 上游 + 落库会话替代真实 OAuth。

## 4. 遗留问题与风险

- 大仓库（>5000 提交）下 `computeLaneLayout` 仍随 `commits` 全量重算，尚未做服务端缓存或增量布局。
- 过滤 / 缩放只作用于**已加载**提交，更早历史需先「加载更多」；自动翻页在过滤生效时暂停。
- 泳道只有颜色区分，没有图例或悬停说明（M2-6 只覆盖文字术语，未覆盖泳道颜色语义）。
- 术语词条为前端静态中文文案，未多语言化（随 M4 国际化统一处理）。
- E2E 依赖 CI 的 Postgres：本地无 Docker / 数据库时无法复跑，回归只能看 CI。

## 5. 结论与下一步

- M2 六个任务全部落地，退出标准达成；「提交列表 → 分支故事」的目标完成。
- 下一步进入 **M3 交互操作**：先搭「确认卡片 + 操作编排 + 审计表」的统一写操作管线（M3-1），再依次实现创建分支 / 创建 Issue / 合并 PR / 删除分支（M3-2 ~ M3-5）。
