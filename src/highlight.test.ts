import { describe, expect, it } from "vitest";
import { buildHighlighted } from "./highlight";

describe("buildHighlighted", () => {
  it("区间包 mark 标签", () => {
    expect(buildHighlighted("README.md", [[0, 5]])).toBe("<mark>README</mark>.md");
  });

  it("无区间原样返回", () => {
    expect(buildHighlighted("abc", [])).toBe("abc");
  });

  it("多区间按序拼接", () => {
    expect(buildHighlighted("a-b", [[0, 0]])).toBe("<mark>a</mark>-b");
  });
});
