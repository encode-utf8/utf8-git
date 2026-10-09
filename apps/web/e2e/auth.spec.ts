import { expect, test } from "@playwright/test";

// 未登录路径：不带会话 Cookie，验证被拦截并跳转登录页（M1-2 验收）
test.use({ storageState: { cookies: [], origins: [] } });

test("未登录访问 /repos 会跳转到登录页", async ({ page }) => {
  await page.goto("/repos");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: "登录 utf8-git" })).toBeVisible();
  await expect(page.getByRole("button", { name: "使用 GitHub 登录" })).toBeVisible();
});

test("登录页展示 repo 权限用途与撤销说明", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByText("申请的权限与用途")).toBeVisible();
  // repo scope 说明必须明确「读取 + 不改写」
  await expect(page.getByText(/不会创建、修改或删除任何仓库内容/)).toBeVisible();
  await expect(page.getByText(/撤销授权/)).toBeVisible();
});
