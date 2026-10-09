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
