import { expect, test } from "@playwright/test";

// 国际化（M4-3）：默认中文；切换语言走 Server Action 写 Cookie，再由服务端按新语言重渲染。
// /permissions 是公开页，不必带会话 —— 用空 storageState 明确未登录路径。
test.use({ storageState: { cookies: [], origins: [] } });

test("默认语言为中文", async ({ page }) => {
  await page.goto("/permissions");
  await expect(page.getByRole("heading", { name: "授权说明" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
});

test("切到 English 后整页英文，且能切回中文", async ({ page }) => {
  await page.goto("/permissions");

  await page.getByRole("button", { name: "切换到English" }).click();
  await expect(page.getByRole("heading", { name: "Authorization notes" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  // 切回：切换器在英文界面下的无障碍名称也随之变化
  await page.getByRole("button", { name: "Switch to 中文" }).click();
  await expect(page.getByRole("heading", { name: "授权说明" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
});
