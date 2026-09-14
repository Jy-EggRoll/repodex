import { describe, expect, it } from "vitest";
import { chunk } from "./batch";

describe("chunk", () => {
  it("splits by chunk size", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("handles empty array and oversized chunk", () => {
    expect(chunk([], 20)).toEqual([]);
    expect(chunk([1, 2], 20)).toEqual([[1, 2]]);
  });
});
