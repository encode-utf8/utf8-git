import { expect, test, type Page } from "@playwright/test";

// 打开首条提交的详情：整行是一个遮罩按钮，行内还浮着 PR / Issue 徽标链接。
// 默认点「元素几何中心」在短行高下可能正好落在徽标上（链接会拦掉点击），
// 因此固定点在行的左上内边距处——那里只有遮罩按钮，两种密度下都稳定。
async function openFirstCommit(page: Page) {
  await page
    .getByRole("list", { name: "提交时间线" })
    .getByRole("button")
    .first()
    .click({ position: { x: 10, y: 10 } });
}

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
  // 横向画布：泳道图层随窗口渲染（mock 为线性历史，泳道数为 1）。
  // 横版把「行」换成「卡片」、滚动轴换成 scrollLeft，SVG 里只剩泳道轨（line）与父子曲线（path）。
  const laneGraph = page.getByRole("list", { name: "提交时间线" }).locator("svg");
  await expect(laneGraph).toBeVisible();
  expect(await laneGraph.locator("line").count()).toBeGreaterThan(0);
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
  await openFirstCommit(page);
  await expect(page.getByText("文件变更（1）")).toBeVisible();
  await page.getByLabel("时间范围").selectOption("all");
  await expect(page.getByText("文件变更（1）")).toBeVisible();
  await expect(page.getByText("筛选后 3 / 60 条")).toHaveCount(0);
});

test("点击提交节点打开文件变更详情面板", async ({ page }) => {
  await page.goto("/repos/encode-utf8/utf8-git");
  await openFirstCommit(page);
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

  // 新手模式：操作入口（分支选择器 / 新建分支 / 新建 Issue / 新建 PR）也给出概念说明
  await expect(page.getByRole("button", { name: "解释：分支" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "解释：议题（Issue）" }).first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "解释：拉取请求（Pull Request）" }).first(),
  ).toBeVisible();

  await page.getByRole("button", { name: "新建分支" }).click();
  await expect(page.getByText("从某个提交分出来的一条独立开发线")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "取消" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

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
  await openFirstCommit(page);
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

test("创建 PR：确认卡片 → 选择 base/head → 调上游创建 → 成功与冲突提示", async ({ page }) => {
  await page.goto("/repos/encode-utf8/utf8-git");
  await page.getByRole("button", { name: "新建 PR" }).click();
  const dialog = page.getByRole("dialog", { name: /创建 PR/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("目标分支（base）")).toHaveValue("main");

  await dialog.getByLabel("来源分支（head）").selectOption("feature/e2e");
  await dialog.getByLabel("PR 标题").fill("feat: 合并时间线");
  await dialog.getByLabel("PR 正文（Markdown）").fill("## 背景\n\n- 说明");
  await expect(dialog.locator("p", { hasText: /^背景$/ })).toBeVisible();

  await dialog.getByRole("button", { name: "创建 PR", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已创建 PR");

  // 冲突：标题含「已存在」→ 上游 422 → 卡片内提示
  await page.getByRole("button", { name: "新建 PR" }).click();
  await page.getByLabel("来源分支（head）").selectOption("feature/e2e");
  await page.getByLabel("PR 标题").fill("已存在的 PR");
  await page.getByRole("button", { name: "创建 PR", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("已存在");
});

test("删除分支：保护规则 → 影响预览 → 删除执行", async ({ page }) => {
  await page.goto("/repos/encode-utf8/utf8-git");
  await page.getByRole("button", { name: "删除分支" }).click();

  const select = page.getByLabel("要删除的分支");
  await expect(select).toBeVisible();

  // 默认分支：只给出不可删除的原因，不提供确认入口（无确认对话框）
  await select.selectOption("main");
  await expect(
    page.getByRole("alert").filter({ hasText: "不可删除：默认分支不能删除" }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // 可删除分支：展示影响预览 → 确认删除 → 状态提示
  await select.selectOption("junk/delete-me");
  const dialog = page.getByRole("dialog", { name: /删除分支/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/不会删除任何提交/)).toBeVisible();
  await dialog.getByRole("button", { name: "删除分支", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已删除分支 junk/delete-me");
});

test("恢复分支：24h 窗口内撤销删除", async ({ page }) => {
  await page.goto("/repos/encode-utf8/utf8-git");

  // 建一个专属分支：写操作失效时间线缓存后，刷新即出现在分支选择器里
  await page.getByRole("button", { name: "新建分支" }).click();
  await page.getByLabel("新分支名称").fill("feature/restore-me");
  await page.getByRole("button", { name: "创建分支", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已创建分支 feature/restore-me");

  // 删除它：审计记录会保存删除前的分支头 SHA，作为恢复依据
  await page.getByRole("button", { name: "删除分支" }).click();
  await page.getByLabel("要删除的分支").selectOption("feature/restore-me");
  const deleteDialog = page.getByRole("dialog", { name: /删除分支/ });
  await expect(deleteDialog).toBeVisible();
  await deleteDialog.getByRole("button", { name: "删除分支", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已删除分支 feature/restore-me");

  // 恢复入口：列出近 24h 的删除记录 → 选回该分支 → 重建引用
  await page.getByRole("button", { name: "恢复分支" }).click();
  const candidate = page.getByRole("radio", { name: /^恢复 feature\/restore-me（/ });
  await expect(candidate).toBeVisible();
  await candidate.check();
  await page
    .getByRole("dialog", { name: /恢复分支/ })
    .getByRole("button", { name: "恢复分支", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("已恢复分支 feature/restore-me");
});

test("操作历史：审计记录含状态、等价命令与结果链接", async ({ page }) => {
  await page.goto("/repos/encode-utf8/utf8-git");

  // 先制造一条可识别的记录
  await page.getByRole("button", { name: "新建分支" }).click();
  await page.getByLabel("新分支名称").fill("feature/history-check");
  await page.getByRole("button", { name: "创建分支", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已创建分支 feature/history-check");

  // 再制造一条可识别的失败记录（上游 422：分支已存在），用于验证状态筛选
  await page.getByRole("button", { name: "新建分支" }).click();
  await page.getByLabel("新分支名称").fill("feature/e2e");
  await page.getByRole("button", { name: "创建分支", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("已存在");

  await page.getByRole("link", { name: "操作历史" }).click();
  await expect(page).toHaveURL(/\/repos\/encode-utf8\/utf8-git\/operations$/);
  await expect(page.getByRole("heading", { name: "操作历史" })).toBeVisible();

  // 每条记录含：操作类型、状态、等价 Git 命令与结果链接
  const item = page.getByRole("listitem").filter({ hasText: "feature/history-check" }).first();
  await expect(item).toContainText("创建分支");
  await expect(item).toContainText("成功");
  await expect(item.locator("code")).toContainText("git push origin");
  await expect(item.getByRole("link", { name: "在 GitHub 查看分支" })).toHaveAttribute(
    "href",
    /\/tree\/feature\/history-check$/,
  );

  // 状态筛选：仅成功 / 仅失败（URL 带上 status 参数，筛选条件可分享）
  await page.getByRole("link", { name: "仅成功" }).click();
  await expect(page).toHaveURL(/\/operations\?status=succeeded$/);
  await expect(page.getByRole("listitem").filter({ hasText: "feature/history-check" })).toHaveCount(
    1,
  );

  await page.getByRole("link", { name: "仅失败" }).click();
  await expect(page).toHaveURL(/\/operations\?status=failed$/);
  await expect(page.getByRole("listitem").filter({ hasText: "feature/history-check" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("listitem").first()).toContainText("失败");

  await page.getByRole("link", { name: "全部" }).click();
  await expect(page).toHaveURL(/\/repos\/encode-utf8\/utf8-git\/operations$/);
  await expect(page.getByRole("listitem").filter({ hasText: "feature/history-check" })).toHaveCount(
    1,
  );
});

// P0 画布改造：拖提交节点到空白处 → 落点就地命名 → 走同一个 create-branch 接口。
// 与按钮路径并存：拖拽是快路径，按钮是键盘 / 无障碍路径（上面几条用例覆盖）。
test("拖提交节点到空白处 → 就地命名建分支", async ({ page }) => {
  await page.goto("/repos/encode-utf8/utf8-git");

  const row = page.getByRole("list", { name: "提交时间线" }).getByRole("button").first();
  await expect(row).toBeVisible();
  const box = await row.boundingBox();
  if (!box) {
    throw new Error("提交行没有可见区域，无法执行拖拽");
  }

  // 按住首张卡片（最新提交）向左拖：超过 8px 阈值才判定为拖动。
  // 方向取左：右侧是删除竖轨与画布右缘，拖过去会落到画布外被取消；
  // 纵向也只微移——泳道少时画布很矮，向下拖多了同样会出界。
  const startX = box.x + 24;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX - 40, startY + 20, { steps: 6 });
  await page.mouse.move(startX - 200, startY + 24, { steps: 6 });
  await page.mouse.up();

  // 落点弹出命名气泡（不是工具栏下面的确认卡片）
  const popover = page.getByRole("dialog", { name: /新建分支/ });
  await expect(popover).toBeVisible();

  const branch = `feature/drag-${Date.now().toString(36)}`;
  await page.getByLabel("新分支名称").fill(branch);
  await page.getByRole("button", { name: "建分支", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(`已创建分支 ${branch}`);
});

// 拖分支芯片到删除区：删除区是常驻右侧竖轨（不再平时隐藏），拖入只是「发起删除」，
// 仍弹出确认浮层（带预选分支 + 服务端可删除性预检），确认后才真正执行。
test("拖分支芯片到删除区 → 确认浮层 → 删除成功", async ({ page }) => {
  await page.goto("/repos/encode-utf8/utf8-git");

  // 删除区常驻：进页面就该看见右侧竖轨
  const trash = page.getByTestId("branch-trash");
  await expect(trash).toBeVisible();

  // 先建一个专属分支（按钮路径），避免动到其它用例依赖的分支
  const branch = `feature/drag-del-${Date.now().toString(36)}`;
  await page.getByRole("button", { name: "新建分支" }).click();
  await page.getByLabel("新分支名称").fill(branch);
  await page.getByRole("button", { name: "创建分支", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(`已创建分支 ${branch}`);

  const chip = page.getByRole("button", { name: branch, exact: true });
  await expect(chip).toBeVisible();
  // 分支多时芯片条横向溢出：新分支可能被裁在容器右侧之外（几何框仍在，
  // 但屏幕坐标落在视口外，鼠标按下不会命中它）。先滚到可见再取坐标。
  await chip.scrollIntoViewIfNeeded();
  const chipBox = await chip.boundingBox();
  if (!chipBox) {
    throw new Error("分支芯片没有可见区域，无法执行拖拽");
  }
  const viewport = page.viewportSize();
  if (viewport && (chipBox.x < 0 || chipBox.x + chipBox.width > viewport.width)) {
    throw new Error(`分支芯片在视口之外（x=${chipBox.x} w=${chipBox.width}）`);
  }

  await page.mouse.move(chipBox.x + chipBox.width / 2, chipBox.y + chipBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(chipBox.x + 40, chipBox.y + 40, { steps: 6 });

  const trashBox = await trash.boundingBox();
  if (!trashBox) {
    throw new Error("删除区没有可见区域，无法完成拖拽");
  }
  await page.mouse.move(trashBox.x + trashBox.width / 2, trashBox.y + trashBox.height / 2, {
    steps: 8,
  });
  await page.mouse.up();

  // 浮层确认：预选就是被拖的那个分支
  const dialog = page.getByRole("dialog", { name: /删除分支/ });
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel("要删除的分支")).toHaveValue(branch);
  await dialog.getByRole("button", { name: "删除分支", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(`已删除分支 ${branch}`);
});

// P1 手势：拖分支芯片到另一个分支芯片 = 从被拖的分支向目标分支开 PR。
// 落点方向即语义（head → base），面板预填后由用户补标题再执行。
test("拖分支芯片到另一分支 → 预填 PR（head → base）", async ({ page }) => {
  await page.goto("/repos/encode-utf8/utf8-git");

  // 用 mock 预置的 feature/e2e 作来源：不在用例里现建分支，
  // 避免建完分支的 router.refresh() 在取坐标与按下之间重排芯片条（run #124/#126 的坑）。
  const source = page.getByRole("button", { name: "feature/e2e", exact: true });
  await expect(source).toBeVisible();
  await source.scrollIntoViewIfNeeded();
  const sourceBox = await source.boundingBox();
  if (!sourceBox) {
    throw new Error("来源分支芯片没有可见区域");
  }
  const sourceCenter = {
    x: sourceBox.x + sourceBox.width / 2,
    y: sourceBox.y + sourceBox.height / 2,
  };
  const hitLabel = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x as number, y as number)?.closest("button")?.textContent,
    [sourceCenter.x, sourceCenter.y],
  );
  if (!hitLabel?.includes("feature/e2e")) {
    throw new Error(`按下位置命中的不是来源芯片：${hitLabel ?? "none"}`);
  }

  const target = page.getByRole("button", { name: /^main/ }).first();
  await target.scrollIntoViewIfNeeded();
  const targetBox = await target.boundingBox();
  if (!targetBox) {
    throw new Error("目标分支芯片没有可见区域");
  }

  await page.mouse.move(sourceCenter.x, sourceCenter.y);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, {
    steps: 10,
  });
  // 松手前先确认落点被识别成 main（跟手浮标出现）：否则说明坐标没落在芯片上
  await expect(page.getByText("松手向 main 开 PR")).toBeVisible();
  await page.mouse.up();

  // 面板预填：来源 = 被拖的分支，目标 = 落点分支
  await expect(page.getByLabel("来源分支（head）")).toHaveValue("feature/e2e");
  await expect(page.getByLabel("目标分支（base）")).toHaveValue("main");

  await page.getByRole("dialog").getByRole("button", { name: "取消" }).click();
  await expect(page.getByLabel("来源分支（head）")).toHaveCount(0);
});

// P1 时间刷子：两端手柄可拖/可用方向键，收窄窗口即按绝对时间过滤；
// 「自定义区间」与下拉互斥，重置回到全量。
test("时间刷子：收窄时间窗 → 过滤 + 自定义区间 → 重置回全量", async ({ page }) => {
  await page.goto("/repos/encode-utf8/utf8-git");
  // 首屏默认加载 50 条（点「加载更多」才到 60）
  await expect(page.getByText("已加载 50 条提交")).toBeVisible();

  const end = page.getByRole("slider", { name: "时间窗右端" });
  await end.focus();
  // Shift + 方向键 = 粗调（1/8 域宽），几下就把右端拉到中段，窗口明显变窄
  for (let index = 0; index < 4; index += 1) {
    await end.press("Shift+ArrowLeft");
  }

  await expect(page.getByLabel("时间范围")).toHaveValue("custom");
  await expect(page.getByText(/筛选后 \d+ \/ 50 条/)).toBeVisible();

  await page.getByRole("button", { name: "重置", exact: true }).click();
  await expect(page.getByLabel("时间范围")).toHaveValue("all");
  await expect(page.getByText(/筛选后 \d+ \/ 50 条/)).toHaveCount(0);
});

// 芯片「⋯」菜单：删除 / 开 PR 的点击等价路径（手势之外的入口，摸不到拖拽也能用）。
// 只验证到「预填正确」为止，不真正执行，避免动到其它用例共享的分支。
test("分支芯片菜单：删除与开 PR 的点击路径都能带出正确预填", async ({ page }) => {
  await page.goto("/repos/encode-utf8/utf8-git");

  const menu = page.getByRole("button", { name: "feature/e2e 的操作菜单" });
  await menu.click();

  // 回归守卫：菜单必须用 position: fixed 渲染在芯片条的横向滚动容器之外。
  // 曾经的 bug 是 absolute 菜单被 overflow-x-auto 裁掉——用户点了「⋯」什么都看不到。
  const menuPanel = page.getByRole("menu");
  await expect(menuPanel).toBeVisible();
  expect(await menuPanel.evaluate((el) => getComputedStyle(el).position)).toBe("fixed");
  const menuBox = await menuPanel.boundingBox();
  const viewport = page.viewportSize();
  if (!menuBox || !viewport) {
    throw new Error("菜单或视口尺寸缺失，无法校验可见性");
  }
  if (menuBox.y + menuBox.height > viewport.height || menuBox.x + menuBox.width > viewport.width) {
    throw new Error("菜单超出视口，说明定位钳制失效");
  }

  await page.getByRole("menuitem", { name: "删除这个分支" }).click();
  await expect(page.getByLabel("要删除的分支")).toHaveValue("feature/e2e");
  await page
    .getByRole("dialog", { name: /删除分支/ })
    .getByRole("button", { name: "取消" })
    .click();

  await menu.click();
  await expect(menuPanel).toBeVisible();
  // 再点一次触发器应当关闭（开合是两个方向，不能只开不合）
  await menu.click();
  await expect(menuPanel).toHaveCount(0);

  await menu.click();
  await page.getByRole("menuitem", { name: "用这个分支开 PR" }).click();
  await expect(page.getByLabel("来源分支（head）")).toHaveValue("feature/e2e");
  await expect(page.getByLabel("目标分支（base）")).toHaveValue("main");
  await page.getByRole("dialog").getByRole("button", { name: "取消" }).click();
});

// 手势速查条：首次进入主动出现一次（流内、不挡操作），关掉后记住；「?」可随时重开。
test("手势速查：首次出现 → 关闭后不再出现 → 「?」重开", async ({ page }) => {
  await page.goto("/repos/encode-utf8/utf8-git");

  const guide = page.getByRole("region", { name: "拖拽手势速查" });
  await expect(guide).toBeVisible();
  // 三条手势说明都在
  await expect(guide.getByText(/拖提交到画布空白处/)).toBeVisible();
  await expect(guide.getByText(/拖分支芯片到另一个分支/)).toBeVisible();
  await expect(guide.getByText(/拖分支芯片到右侧竖轨/)).toBeVisible();

  await page.getByRole("button", { name: "知道了" }).click();
  await expect(guide).toHaveCount(0);

  // 刷新后仍然不再出现（localStorage 记忆）。先等列表渲染完，
  // 确认挂载后的读取逻辑确实跑过，否则 toHaveCount(0) 可能只是「还没渲染」
  await page.reload();
  await expect(page.getByText("已加载 50 条提交")).toBeVisible();
  await expect(page.getByRole("region", { name: "拖拽手势速查" })).toHaveCount(0);

  // 工具栏「?」重新打开
  await page.getByRole("button", { name: "重新查看手势提示" }).click();
  await expect(page.getByRole("region", { name: "拖拽手势速查" })).toBeVisible();
});

// 芯片菜单的键盘路径：打开即聚焦第一项，方向键循环，Esc 关闭并把焦点还给触发器。
test("芯片菜单键盘导航：方向键移动、Esc 关闭并归还焦点", async ({ page }) => {
  await page.goto("/repos/encode-utf8/utf8-git");

  const trigger = page.getByRole("button", { name: "feature/e2e 的操作菜单" });
  await trigger.click();

  const items = page.getByRole("menuitem");
  await expect(items).toHaveCount(3);
  await expect(items.first()).toBeFocused();

  await page.keyboard.press("ArrowDown");
  await expect(items.nth(1)).toBeFocused();

  await page.keyboard.press("End");
  await expect(items.nth(2)).toBeFocused();

  // 末项再按 ↓ 环绕回第一项
  await page.keyboard.press("ArrowDown");
  await expect(items.first()).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

// 分享链接（TODO-214 链接分享）：筛选写进 URL，复制后在新页面打开能还原视图。
test("分享链接：筛选写进 URL，打开链接可恢复", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/repos/encode-utf8/utf8-git");

  const search = page.getByLabel("搜索提交");
  await search.fill("feat");
  // 防抖 300ms 后地址栏跟上（replaceState，不产生历史记录）
  await expect(page).toHaveURL(/[?&]q=feat/);

  await page.getByRole("button", { name: "分享链接" }).click();
  await expect(page.getByTestId("share-status")).toHaveText("链接已复制");

  const shared = page.url();
  expect(shared).toContain("q=feat");

  const reopened = await context.newPage();
  await reopened.goto(shared);
  await expect(reopened.getByLabel("搜索提交")).toHaveValue("feat");
  await expect(reopened.getByText(/筛选后 \d+ \/ 50 条/)).toBeVisible();
  await reopened.close();
});

// 分享链接里的 branch 参数：进页面后自动切到该分支（芯片处于选中态）。
test("分享链接：branch 参数进入即切换分支", async ({ page }) => {
  await page.goto("/repos/encode-utf8/utf8-git?branch=feature%2Fe2e");

  await expect(page.getByRole("button", { name: "feature/e2e", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
