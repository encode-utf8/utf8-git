import { describe, expect, it } from "vitest";
import { pickBranchColor } from "./color";

describe("pickBranchColor", () => {
  it("对同一分支名返回稳定颜色", () => {
    expect(pickBranchColor("main")).toBe(pickBranchColor("main"));
  });

  it("返回合法的 HSL 颜色", () => {
    expect(pickBranchColor("feature/timeline")).toMatch(/^hsl\(\d{1,3} 65% 55%\)$/);
  });

  it("色相落在 0-359 范围内", () => {
    const hue = Number(/hsl\((\d+)/.exec(pickBranchColor("main"))?.[1]);
    expect(hue).toBeGreaterThanOrEqual(0);
    expect(hue).toBeLessThan(360);
  });

  it("不同分支名通常得到不同颜色", () => {
    expect(pickBranchColor("main")).not.toBe(pickBranchColor("develop"));
  });
});
