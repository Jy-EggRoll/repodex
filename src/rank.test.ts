import { describe, expect, it } from "vitest";
import { compareRank, rankKeyFromRanges, type RankKey } from "./rank";

// Measured data (query=readme): the top four used to tie and fall back to insertion order; now this order is required
const measured: Array<[string, Array<[number, number]>]> = [
  ["README.md", [[0, 5]]],
  ["myreadmebackup", [[2, 7]]],
  ["llm_course/README.md", [[11, 16]]],
  ["llm_course/data/docs/readmemo.md", [[21, 26]]],
];

describe("compareRank", () => {
  it("sorts short and precise matches first", () => {
    const keys = measured.map(([t, r]) => rankKeyFromRanges(r, t.length) as RankKey);
    const sorted = [...keys].sort(compareRank);
    expect(sorted.map((k) => k.targetLen)).toEqual([9, 14, 20, 32]);
  });

  it("with equal coverage, the earlier position wins", () => {
    const a = rankKeyFromRanges([[2, 5]], 10) as RankKey;
    const b = rankKeyFromRanges([[0, 3]], 10) as RankKey;
    expect(compareRank(b, a)).toBeLessThan(0);
  });

  it("with equal coverage and position, the more compact match wins", () => {
    const scattered = rankKeyFromRanges(
      [
        [0, 0],
        [2, 2],
        [4, 4],
      ],
      10,
    ) as RankKey;
    const solid = rankKeyFromRanges([[0, 2]], 10) as RankKey;
    expect(compareRank(solid, scattered)).toBeLessThan(0);
  });

  it("returns null for empty ranges", () => {
    expect(rankKeyFromRanges([], 10)).toBeNull();
  });
});
