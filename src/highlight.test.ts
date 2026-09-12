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

  it("HTML 特殊字符全部转义", () => {
    expect(buildHighlighted(`<img src=x onerror="alert(1)">`, [])).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
    );
  });

  it("区间内的特殊字符同样转义，mark 标签仍正常", () => {
    expect(buildHighlighted("</mark>", [[0, 6]])).toBe("<mark>&lt;/mark&gt;</mark>");
  });

  it("& 与单引号转义", () => {
    expect(buildHighlighted("a&b'c", [])).toBe("a&amp;b&#39;c");
  });
});
