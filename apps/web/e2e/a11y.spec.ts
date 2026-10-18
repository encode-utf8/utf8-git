import { expect, test } from "@playwright/test";

// 可访问性（M4-4 / TODO-244）：跳过导航、键盘焦点可见、英文已登录路径。
// 登录态由 playwright.config.ts 的 storageState 提供（globalSetup 落库的数据库会话）。
// 报告：docs/reports/tech-analysis/M4-4-a11y-audit.md

test("跳过导航链接是第一个可聚焦元素，回车后进入主内容", async ({ page }) => {
  await page.goto("/repos");
  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "跳到主要内容" });
  await expect(skipLink).toBeFocused();
  // sr-only → 聚焦后转为可见（not-sr-only）
  await expect(skipLink).toBeVisible();

  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main-content$/);
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("main-content");
});

test("提交行获得键盘焦点时有可见描边（回归 M4-4 修复 1）", async ({ page }) => {
  await page.goto("/repos");
  await page.getByRole("link", { name: "encode-utf8/utf8-git", exact: true }).click();
  await expect(page.getByRole("heading", { name: "encode-utf8/utf8-git" })).toBeVisible();

  const firstRowButton = page
    .getByRole("list", { name: "提交时间线" })
    .getByRole("button")
    .first();
  // 先制造一次键盘交互再编程式聚焦，Chromium 才会对该元素应用 :focus-visible
  await page.keyboard.press("Tab");
  await firstRowButton.focus();
  await expect(firstRowButton).toBeFocused();

  const outline = await firstRowButton.evaluate((element) => {
    const style = getComputedStyle(element);
    return { style: style.outlineStyle, width: style.outlineWidth };
  });
  expect(outline.style).not.toBe("none");
  expect(Number.parseFloat(outline.width)).toBeGreaterThanOrEqual(2);
});

test("已登录页面可切换英文并保留登录态（英文路径覆盖）", async ({ page }) => {
  await page.goto("/repos");
  await expect(page.getByRole("heading", { name: "我的仓库" })).toBeVisible();

  await page.getByRole("button", { name: "切换到English" }).click();
  await expect(page.getByRole("heading", { name: "My repositories" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  // 已登录界面文案随语言切换（TODO-247 的迁移面）
  await expect(page.getByPlaceholder("Search repository name or description")).toBeVisible();

  await page.getByRole("button", { name: "Switch to 中文" }).click();
  await expect(page.getByRole("heading", { name: "我的仓库" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
});
