import { describe, expect, it } from "vitest";
import { chunk } from "./batch";

describe("chunk", () => {
  it("按大小分块", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("空数组与超大块", () => {
    expect(chunk([], 20)).toEqual([]);
    expect(chunk([1, 2], 20)).toEqual([[1, 2]]);
  });
});
