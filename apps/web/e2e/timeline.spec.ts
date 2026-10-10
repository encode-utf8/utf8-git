import { expect, test } from "@playwright/test";

// 登录态由 playwright.config.ts 的 storageState 提供（globalSetup 落库的数据库会话）。
// 覆盖 TODO-142：登录（mock）→ 选仓库 → 浏览时间线。
test("仓库列表 → 时间线 → 翻页（只读最小闭环）", async ({ page }) => {
  await page.goto("/repos");
  await expect(page.getByRole("heading", { name: "我的仓库" })).toBeVisible();
  await expect(page.getByText("共 2 个仓库")).toBeVisible();
  await expect(page.getByText("encode-utf8/utf8-git")).toBeVisible();
  await expect(page.getByText("encode-utf8/secret-notes")).toBeVisible();
  // 私有仓库带可见性标识
  await expect(page.getByText("私有").first()).toBeVisible();

  await page.getByRole("link", { name: "encode-utf8/utf8-git", exact: true }).click();
  await expect(page).toHaveURL(/\/repos\/encode-utf8\/utf8-git$/);
  await expect(page.getByRole("heading", { name: "encode-utf8/utf8-git" })).toBeVisible();
  await expect(page.getByText("公开").first()).toBeVisible();

  // 第 1 页 50 条，最新提交可见
  await expect(page.getByText("feat: 时间线提交 #60")).toBeVisible();
  await expect(page.getByText("已加载 50 条提交")).toBeVisible();
  // M2-2：泳道图层随窗口渲染（mock 为线性历史，泳道数为 1）
  const laneGraph = page.getByRole("list", { name: "提交时间线" }).locator("svg");
  await expect(laneGraph).toBeVisible();
  expect(await laneGraph.locator("circle").count()).toBeGreaterThan(0);
  expect(await laneGraph.locator("path").count()).toBeGreaterThan(0);
  // M2-3：关联 PR / Issue 标注为可跳转 GitHub 的链接（mock 第 60 号提交带 PR/Issue）
  await expect(page.getByRole("link", { name: "#60 已合并" })).toHaveAttribute(
    "href",
    /\/pull\/60$/,
  );
  await expect(page.getByRole("link", { name: "#1060 已关闭" })).toHaveAttribute(
    "href",
    /\/issues\/1060$/,
  );

  // 翻到第 2 页（10 条），到底后显示「已到最底部」
  await page.getByRole("button", { name: "加载更多" }).click();
  await expect(page.getByText("已加载 60 条提交")).toBeVisible();
  await expect(page.getByText("已到最底部")).toBeVisible();
  // M2-4：客户端即时过滤（关键词 / 事件类型），数量提示实时更新
  await page.getByLabel("搜索提交").fill("#59");
  await expect(page.getByText("筛选后 1 / 60 条")).toBeVisible();
  await page.getByRole("button", { name: "清除筛选" }).click();
  await page.getByLabel("按事件类型过滤").selectOption("pullRequest");
  await expect(page.getByText("筛选后 6 / 60 条")).toBeVisible();
  await expect(page.getByText("feat: 时间线提交 #59")).toHaveCount(0);
  await page.getByLabel("按事件类型过滤").selectOption("all");
  await expect(page.getByText("筛选后 6 / 60 条")).toHaveCount(0);
  // M2-5：时间范围缩放（mock 每条相隔 3 天：近一周 3 条、近一月 10 条）
  await page.getByLabel("时间范围").selectOption("week");
  await expect(page.getByText("筛选后 3 / 60 条")).toBeVisible();
  await page.getByLabel("时间范围").selectOption("month");
  await expect(page.getByText("筛选后 10 / 60 条")).toBeVisible();
  // 缩放保持选中上下文：选中最新提交后切换范围，详情面板不关闭
  await page.getByRole("list", { name: "提交时间线" }).getByRole("button").first().click();
  await expect(page.getByText("文件变更（1）")).toBeVisible();
  await page.getByLabel("时间范围").selectOption("all");
  await expect(page.getByText("文件变更（1）")).toBeVisible();
  await expect(page.getByText("筛选后 3 / 60 条")).toHaveCount(0);
});

test("点击提交节点打开文件变更详情面板", async ({ page }) => {
  await page.goto("/repos/encode-utf8/utf8-git");
  await page.getByRole("list", { name: "提交时间线" }).getByRole("button").first().click();
  await expect(page.getByText("文件变更（1）")).toBeVisible();
  await expect(page.getByText("src/index.ts")).toBeVisible();
});

test("概念解释层：默认关闭，切换模式后显示术语悬浮卡片", async ({ page }) => {
  await page.goto("/repos/encode-utf8/utf8-git");
  const modeSelect = page.getByLabel("术语解释模式");
  await expect(modeSelect).toHaveValue("off");
  // 默认关闭：不渲染任何术语提示（可关闭、不干扰老用户）
  await expect(page.getByRole("button", { name: /^解释：/ })).toHaveCount(0);

  // 新手模式：基础术语出现，悬停弹出解释卡片
  await modeSelect.selectOption("beginner");
  const shaHint = page.getByRole("button", { name: "解释：提交哈希（SHA）" }).first();
  await expect(shaHint).toBeVisible();
  await shaHint.hover();
  await expect(page.getByRole("tooltip")).toContainText("提交哈希");

  // 进阶模式：基础术语隐藏，进阶术语保留
  await modeSelect.selectOption("advanced");
  await expect(page.getByRole("button", { name: "解释：提交哈希（SHA）" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "解释：泳道" })).toBeVisible();

  // 关闭后不再渲染
  await modeSelect.selectOption("off");
  await expect(page.getByRole("button", { name: /^解释：/ })).toHaveCount(0);
});

test("创建分支：确认卡片 → 调上游建分支 → 成功与冲突提示", async ({ page }) => {
  await page.goto("/repos/encode-utf8/utf8-git");
  await page.getByRole("button", { name: "新建分支" }).click();
  // 确认卡片默认以最新提交为起点，展示影响预览
  await expect(page.getByRole("dialog", { name: /创建分支/ })).toBeVisible();
  await expect(page.getByText(/起点：提交/)).toBeVisible();

  // 成功：新分支名 → 上游 201 → 成功提示
  await page.getByLabel("新分支名称").fill("feature/e2e-created");
  await page.getByRole("button", { name: "创建分支", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已创建分支 feature/e2e-created");

  // 冲突：mock 中已存在的分支 → 上游 422 → 提示已存在
  await page.getByRole("button", { name: "新建分支" }).click();
  await page.getByLabel("新分支名称").fill("feature/e2e");
  await page.getByRole("button", { name: "创建分支", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("已存在");
});

test("创建 Issue：确认卡片 → Markdown 预览 → 调上游创建 → 成功与冲突提示", async ({ page }) => {
  await page.goto("/repos/encode-utf8/utf8-git");
  await page.getByRole("button", { name: "新建 Issue" }).click();
  const dialog = page.getByRole("dialog", { name: /创建 Issue/ });
  await expect(dialog).toBeVisible();

  // 填写标题 / 正文 / 标签
  await page.getByLabel("Issue 标题").fill("时间线排序异常");
  await page.getByLabel("正文（Markdown）").fill("## 步骤\n\n- 打开页面\n\n**期望**：按时间倒序");
  await page.getByLabel("标签（逗号分隔）").fill("bug, ui");

  // Markdown 预览：正文渲染为结构化元素（不做 HTML 注入）
  await expect(dialog.locator("p", { hasText: /^步骤$/ })).toBeVisible();
  await expect(dialog.locator("li", { hasText: "打开页面" })).toBeVisible();
  await expect(dialog.locator("strong", { hasText: "期望" })).toBeVisible();

  // 成功：mock 返回 201 → 状态提示
  await page.getByRole("button", { name: "创建 Issue", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已创建 Issue");

  // 冲突：mock 对标题含「已存在」返回 422 → 卡片内 alert 提示
  await page.getByRole("button", { name: "新建 Issue" }).click();
  await page.getByLabel("Issue 标题").fill("已存在的标题");
  await page.getByRole("button", { name: "创建 Issue", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("不被接受");
});

test("合并 PR：可合并性检查 → 确认合并 → 冲突提示", async ({ page }) => {
  await page.goto("/repos/encode-utf8/utf8-git");
  await page.getByRole("list", { name: "提交时间线" }).getByRole("button").first().click();
  const detail = page.getByRole("dialog", { name: "提交详情" });
  await expect(detail).toBeVisible();

  // 可合并：检查通过 → 确认合并 → 状态提示
  await detail.getByRole("button", { name: "合并 PR #61" }).click();
  const mergeDialog = detail.getByRole("dialog", { name: /合并 PR #61/ });
  await expect(mergeDialog).toBeVisible();
  await expect(mergeDialog.getByText("可合并性检查：可合并")).toBeVisible();
  await mergeDialog.getByRole("button", { name: "合并 PR", exact: true }).click();
  await expect(detail.getByRole("status")).toContainText("已合并 PR #61");

  // 冲突：#62 的检查结果不可合并 → 仅给出原因，不提供确认按钮
  await detail.getByRole("button", { name: "合并 PR #62" }).click();
  await expect(detail.getByRole("alert")).toContainText("可合并性检查：存在合并冲突");
  await expect(detail.getByRole("button", { name: "合并 PR", exact: true })).toHaveCount(0);
});
