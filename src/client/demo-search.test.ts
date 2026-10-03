import { describe, expect, it } from "vitest";
import { SCORE_CAP } from "../search-core";
import { ApiError } from "./api";
import {
  DEMO_GITHUB,
  listIndexes,
  listRepos,
  searchIndexes,
} from "./demo-search";

describe("demo-search", () => {
  it("index and repo lists are non-empty", async () => {
    expect(await listIndexes()).toHaveLength(5);
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
    const keys1 = new Set(
      p1.results.map((r) => `${r.repository}|${r.branch}|${r.path}`),
    );
    for (const r of p2.results) {
      expect(keys1.has(`${r.repository}|${r.branch}|${r.path}`)).toBe(false);
    }
  });

  it("is deterministic across calls (timings excluded)", async () => {
    const a = await searchIndexes("md", "all", "path", 50, 0);
    const b = await searchIndexes("md", "all", "path", 50, 0);
    expect({ ...a, tookMs: 0, loadMs: 0, searchMs: 0 }).toEqual({
      ...b,
      tookMs: 0,
      loadMs: 0,
      searchMs: 0,
    });
  });

  it("keeps production's error codes for bad input", async () => {
    await expect(searchIndexes(" ", "all", "path")).rejects.toBeInstanceOf(
      ApiError,
    );
    await expect(
      searchIndexes("readme", "not-a-full-name", "path"),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      searchIndexes("readme", "ghost/repo", "path"),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("drops unknown names from a list selection instead of failing", async () => {
    const out = await searchIndexes(
      "md",
      "repodex-demo/demo-tiny,ghost/repo",
      "path",
      100,
      0,
    );
    expect(out.total).toBeGreaterThan(0);
    expect(
      out.results.every((r) => r.repository === "repodex-demo/demo-tiny"),
    ).toBe(true);
  });

  it("applies the production score cap and reports truncation", async () => {
    const out = await searchIndexes("s", "all", "path", 100, 0);
    expect(out.truncated).toBe(true);
    expect(out.total).toBe(SCORE_CAP);
  });

  it("keeps production's paging quirks", async () => {
    // limit=0 falls back to the default page size; a negative limit clamps to 1; a negative offset clamps to 0
    expect(
      (await searchIndexes("md", "all", "path", 0, 0)).results,
    ).toHaveLength(100);
    expect(
      (await searchIndexes("md", "all", "path", -5, 0)).results,
    ).toHaveLength(1);
    expect((await searchIndexes("md", "all", "path", 1, -5)).results).toEqual(
      (await searchIndexes("md", "all", "path", 1, 0)).results,
    );
  });

  it("links every result to the demo repository", async () => {
    const out = await searchIndexes("readme", "all", "path", 100, 0);
    expect(out.results.length).toBeGreaterThan(0);
    expect(out.results.every((r) => r.github_url === DEMO_GITHUB)).toBe(true);
  });
});
