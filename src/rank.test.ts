import { describe, expect, it } from "vitest";
import { compareRank, rankKeyFromRanges, type RankKey } from "./rank";

// 实测数据（query=readme）：以前四条打平按入库顺序排，现在必须按此序
const measured: Array<[string, Array<[number, number]>]> = [
  ["README.md", [[0, 5]]],
  ["myreadmebackup", [[2, 7]]],
  ["llm_course/README.md", [[11, 16]]],
  ["llm_course/data/docs/readmemo.md", [[21, 26]]],
];

describe("compareRank", () => {
  it("短而准的排前面", () => {
    const keys = measured.map(([t, r]) => rankKeyFromRanges(r, t.length) as RankKey);
    const sorted = [...keys].sort(compareRank);
    expect(sorted.map((k) => k.targetLen)).toEqual([9, 14, 20, 32]);
  });

  it("同覆盖率时位置靠前者胜", () => {
    const a = rankKeyFromRanges([[2, 5]], 10) as RankKey;
    const b = rankKeyFromRanges([[0, 3]], 10) as RankKey;
    expect(compareRank(b, a)).toBeLessThan(0);
  });

  it("同覆盖同位置时连续者胜", () => {
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

  it("空 ranges 返回 null", () => {
    expect(rankKeyFromRanges([], 10)).toBeNull();
  });
});
