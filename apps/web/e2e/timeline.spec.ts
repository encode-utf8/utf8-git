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

  // 翻到第 2 页（10 条），到底后显示「已到最底部」
  await page.getByRole("button", { name: "加载更多" }).click();
  await expect(page.getByText("已加载 60 条提交")).toBeVisible();
  await expect(page.getByText("已到最底部")).toBeVisible();
});

test("点击提交节点打开文件变更详情面板", async ({ page }) => {
  await page.goto("/repos/encode-utf8/utf8-git");
  await page.getByRole("list", { name: "提交时间线" }).getByRole("button").first().click();
  await expect(page.getByText("文件变更（1）")).toBeVisible();
  await expect(page.getByText("src/index.ts")).toBeVisible();
});
