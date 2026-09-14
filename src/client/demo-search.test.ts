import { describe, expect, it } from "vitest";
import { listIndexes, listRepos, searchIndexes } from "./demo-search";

describe("demo-search", () => {
  it("index and repo lists are non-empty", async () => {
    expect(listIndexes()).toHaveLength(5);
    expect(listRepos()).toHaveLength(5);
  });

  it("covers all three risk badges", async () => {
    const risks = new Set(listRepos().map((r) => r.risk));
    expect(risks).toEqual(new Set(["safe", "warn", "danger"]));
  });

  it("finds matches by English and by pinyin", async () => {
    const en = await searchIndexes("readme", "all", "path", 100, 0);
    expect(en.total).toBeGreaterThan(0);
    const cn = await searchIndexes("baogao", "all", "name", 100, 0);
    expect(cn.total).toBeGreaterThan(0);
  });

  it("pages do not overlap", async () => {
    const p1 = await searchIndexes("md", "all", "path", 50, 0);
    const p2 = await searchIndexes("md", "all", "path", 50, 50);
    const keys1 = new Set(p1.results.map((r) => `${r.repository}|${r.branch}|${r.path}`));
    for (const r of p2.results) {
      expect(keys1.has(`${r.repository}|${r.branch}|${r.path}`)).toBe(false);
    }
  });
});
