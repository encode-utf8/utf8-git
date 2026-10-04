import { describe, expect, it } from "vitest";
import { cn } from "./cn";

describe("cn", () => {
  it("合并普通类名", () => {
    expect(cn("flex", "gap-2")).toBe("flex gap-2");
  });

  it("后者覆盖冲突的 Tailwind 类", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });

  it("忽略假值输入", () => {
    expect(cn("flex", undefined, false, "gap-2")).toBe("flex gap-2");
  });
});
