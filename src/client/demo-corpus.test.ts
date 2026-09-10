import { describe, expect, it } from "vitest";
import { buildDemoCorpus, DEMO_SEED } from "./demo-corpus";

describe("buildDemoCorpus", () => {
  it("同一种子输出完全一致", () => {
    expect(buildDemoCorpus(DEMO_SEED)).toEqual(buildDemoCorpus(DEMO_SEED));
  });

  it("三仓库多分支，有文件有目录", () => {
    const repos = buildDemoCorpus();
    expect(repos).toHaveLength(3);
    const files = repos.flatMap((r) => r.branches.flatMap((b) => b.files));
    const dirs = repos.flatMap((r) => r.branches.flatMap((b) => b.directories));
    expect(files.length).toBeGreaterThan(200);
    expect(dirs.length).toBeGreaterThan(0);
    expect(files[0]).toHaveProperty("name");
    expect(files[0].path.startsWith("./")).toBe(true);
  });

  it("含中文文件名（拼音可搜）", () => {
    const names = buildDemoCorpus().flatMap((r) => r.branches.flatMap((b) => b.files.map((f) => f.name)));
    expect(names.some((n) => /[\u4e00-\u9fa5]/.test(n))).toBe(true);
  });
});
