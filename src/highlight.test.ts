import { describe, expect, it } from "vitest";
import { buildHighlighted } from "./highlight";

describe("buildHighlighted", () => {
  it("wraps ranges in mark tags", () => {
    expect(buildHighlighted("README.md", [[0, 5]])).toBe("<mark>README</mark>.md");
  });

  it("returns the target unchanged when there are no ranges", () => {
    expect(buildHighlighted("abc", [])).toBe("abc");
  });

  it("concatenates multiple ranges in order", () => {
    expect(buildHighlighted("a-b", [[0, 0]])).toBe("<mark>a</mark>-b");
  });

  it("escapes all HTML special characters", () => {
    expect(buildHighlighted(`<img src=x onerror="alert(1)">`, [])).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
    );
  });

  it("escapes special characters inside ranges while mark tags stay intact", () => {
    expect(buildHighlighted("</mark>", [[0, 6]])).toBe("<mark>&lt;/mark&gt;</mark>");
  });

  it("escapes ampersands and single quotes", () => {
    expect(buildHighlighted("a&b'c", [])).toBe("a&amp;b&#39;c");
  });
});
