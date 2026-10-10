import path from "node:path";

import { expect, test } from "@playwright/test";

// M3-9 账号数据与授权：/me 的授权信息 + 两个危险操作（撤销授权 / 清除数据）。
// 这两个流程会删掉自己的令牌 / 会话 / 账号记录，因此各自使用独立的 storageState
// （global-setup 里单独落库的用户），跑完不影响其他用例共用的主账号。
const REVOKE_STATE = path.resolve(process.cwd(), "e2e/.auth/revoke-state.json");
const PURGE_STATE = path.resolve(process.cwd(), "e2e/.auth/purge-state.json");

const HOME_URL = /^http:\/\/127\.0\.0\.1:\d+\/$/;

test("账号页展示已授权信息与危险操作入口", async ({ page }) => {
  await page.goto("/me");
  await expect(page.getByRole("heading", { name: "我的账号" })).toBeVisible();
  await expect(page.getByText("read:user repo")).toBeVisible();
  await expect(page.getByText("令牌有效期至")).toBeVisible();
  await expect(page.getByText("写操作审计")).toBeVisible();

  await expect(page.getByRole("heading", { name: "危险操作" })).toBeVisible();
  await expect(page.getByRole("button", { name: "撤销 GitHub 授权" })).toBeVisible();
  await expect(page.getByRole("button", { name: "清除我的数据" })).toBeVisible();
});

test.describe("撤销 GitHub 授权", () => {
  test.use({ storageState: REVOKE_STATE });

  test("取消不产生副作用；确认后令牌撤销并结束会话", async ({ page }) => {
    await page.goto("/me");

    await page.getByRole("button", { name: "撤销 GitHub 授权" }).click();
    const dialog = page.getByRole("dialog", { name: /撤销 utf8-git 的 GitHub 授权/ });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/删除本应用保存的令牌密文/)).toBeVisible();

    // 取消：卡片关闭，不发起任何写操作
    await dialog.getByRole("button", { name: "取消" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page).toHaveURL(/\/me$/);

    // 确认：GitHub 侧撤销 + 本地清令牌 / 会话
    await page.getByRole("button", { name: "撤销 GitHub 授权" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "撤销授权", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("已撤销 GitHub 授权");

    // 会话已结束：退出后 /me 回到登录页
    await page.getByRole("button", { name: "退出并返回首页" }).click();
    await expect(page).toHaveURL(HOME_URL);
    await page.goto("/me");
    await expect(page).toHaveURL(/\/login\?callbackUrl=/);
  });
});

test.describe("清除我的数据", () => {
  test.use({ storageState: PURGE_STATE });

  test("确认后清除账号数据、退出登录，且说明不影响 GitHub", async ({ page }) => {
    await page.goto("/me");

    await page.getByRole("button", { name: "清除我的数据" }).click();
    const dialog = page.getByRole("dialog", { name: /清除 utf8-git 中的账号数据/ });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/写操作审计记录（\d+ 条）/)).toBeVisible();
    await expect(dialog.getByText(/不会影响 GitHub 上的仓库/)).toBeVisible();

    await dialog.getByRole("button", { name: "清除数据", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("已清除本应用内的账号数据");

    await page.getByRole("button", { name: "退出并返回首页" }).click();
    await expect(page).toHaveURL(HOME_URL);
    await page.goto("/me");
    await expect(page).toHaveURL(/\/login\?callbackUrl=/);
  });
});
