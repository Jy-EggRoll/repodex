import { describe, expect, it } from "vitest";
import { compareRank, rankKeyFromRanges, recencyBoost, type RankKey } from "./rank";

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

describe("recencyBoost", () => {
  const now = 1760000000000;
  const day = 86400000;

  it("starts at +50% for a fresh push and halves every 30 days", () => {
    expect(recencyBoost(now, now)).toBe(1.5);
    expect(recencyBoost(now - 30 * day, now)).toBe(1.25);
    expect(recencyBoost(now - 60 * day, now)).toBe(1.125);
  });

  it("decays towards neutral, clamps future timestamps, and treats unknown ones as neutral", () => {
    expect(recencyBoost(now - 365 * day, now)).toBeCloseTo(1, 2);
    expect(recencyBoost(now + 5 * day, now)).toBe(1.5);
    expect(recencyBoost(undefined, now)).toBe(1);
    expect(recencyBoost(NaN, now)).toBe(1);
  });
});

describe("compareRank with recency", () => {
  it("a fresh repository overtakes a stale one at equal coverage", () => {
    const fresh = rankKeyFromRanges([[0, 2]], 10, 1.5) as RankKey;
    const stale = rankKeyFromRanges([[0, 2]], 10) as RankKey;
    expect(compareRank(fresh, stale)).toBeLessThan(0);
  });

  it("a large coverage gap is never overturned by freshness", () => {
    const freshWeak = rankKeyFromRanges([[0, 2]], 10, 1.5) as RankKey; // 0.3 * 1.5 = 0.45
    const staleStrong = rankKeyFromRanges([[0, 6]], 10) as RankKey; // 0.7
    expect(compareRank(staleStrong, freshWeak)).toBeLessThan(0);
  });

  it("boost defaults to neutral so existing callers are unaffected", () => {
    expect((rankKeyFromRanges([[0, 5]], 10) as RankKey).boost).toBe(1);
  });
});
