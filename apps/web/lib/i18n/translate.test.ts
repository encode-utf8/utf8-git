import { describe, expect, it } from "vitest";

import { createTranslator, type MessageKey } from "./translate";

describe("createTranslator", () => {
  it("按点号路径取当前语言的文案", () => {
    expect(createTranslator("zh-CN").t("login.title")).toBe("登录 utf8-git");
    expect(createTranslator("en").t("login.title")).toBe("Sign in to utf8-git");
  });

  it("支持 {name} 插值；缺失参数原样保留以便发现漏传", () => {
    const { t } = createTranslator("zh-CN");
    expect(t("locale.switchTo", { language: "English" })).toBe("切换到English");
    expect(t("locale.switchTo")).toBe("切换到{language}");
  });

  it("同时带出当前语言", () => {
    expect(createTranslator("en").locale).toBe("en");
  });

  it("未知键回退为键名本身（目录被裁剪时的兜底）", () => {
    const { t } = createTranslator("en");
    expect(t("missing.key" as unknown as MessageKey)).toBe("missing.key");
  });
});
