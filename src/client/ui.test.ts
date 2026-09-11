import { describe, expect, it } from "vitest";
import { staggerDelayMs } from "./ui";

describe("staggerDelayMs", () => {
  it("按下标线性错峰", () => {
    expect(staggerDelayMs(0)).toBe(0);
    expect(staggerDelayMs(3)).toBe(120);
  });

  it("超过上限后钳制到最大延迟", () => {
    expect(staggerDelayMs(11)).toBe(440);
    expect(staggerDelayMs(99)).toBe(440);
  });
});
