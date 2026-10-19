import { expect, test } from "@playwright/test";

// 落地页（TODO-259）：产品介绍 + 登录入口 + 文档导航。
// 页面公开（未登录也能看），用空 storageState 明确这一点。
// 语言由 playwright.config.ts 固定为 zh-CN，断言用默认语言的文案。

test.use({ storageState: { cookies: [], origins: [] } });

test("落地页：产品介绍、登录入口与文档导航", async ({ page }) => {
  await page.goto("/");

  // 产品介绍：主标题 + 一段副标题 + 四张特性卡
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("用一张画布，看清一个仓库");
  await expect(page.getByText(/确认 \+ 幂等 \+ 审计/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "为什么不是又一个 GitHub 客户端" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "写操作有护栏" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "三步开始" })).toBeVisible();

  // 登录入口：未登录时主按钮是「使用 GitHub 登录」
  await expect(page.getByRole("button", { name: "使用 GitHub 登录" })).toBeVisible();

  // 界面示意（装饰图，但对读屏有说明）
  await expect(page.getByRole("img", { name: /界面示意/ })).toBeVisible();

  // 文档导航：四篇文档都指向 GitHub 仓库
  const docs = [
    "README · 项目总览与快速开始",
    "自建与自部署指南（含自建 OAuth App）",
    "部署、多实例一致性与运维手册",
    "开发日志与架构决策记录（ADR）",
  ];
  for (const label of docs) {
    await expect(page.getByRole("link", { name: new RegExp(label) })).toHaveAttribute(
      "href",
      /^https:\/\/github\.com\/encode-utf8\/utf8-git/,
    );
  }

  // 快速链接：登录页 / 权限说明站内可达
  await expect(page.getByRole("link", { name: "登录页" })).toHaveAttribute("href", "/login");
  await expect(page.getByRole("link", { name: "权限说明" })).toHaveAttribute(
    "href",
    "/permissions",
  );
});
