import { describe, expect, it } from "vitest";
import { resolveMode } from "./theme";

describe("resolveMode", () => {
  it("手动值优先于系统", () => {
    expect(resolveMode("light", true)).toBe("light");
    expect(resolveMode("dark", false)).toBe("dark");
  });

  it("auto 跟随系统", () => {
    expect(resolveMode("auto", true)).toBe("dark");
    expect(resolveMode("auto", false)).toBe("light");
  });

  it("无记忆时默认跟随系统", () => {
    expect(resolveMode(null, true)).toBe("dark");
    expect(resolveMode(null, false)).toBe("light");
  });
});
