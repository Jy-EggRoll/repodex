import { describe, expect, it } from "vitest";
import { buildDemoCorpus, DEMO_SEED } from "./demo-corpus";

describe("buildDemoCorpus", () => {
  it("same seed produces identical output", () => {
    expect(buildDemoCorpus(DEMO_SEED)).toEqual(buildDemoCorpus(DEMO_SEED));
  });

  it("five repos with branches, files, and directories", () => {
    const repos = buildDemoCorpus();
    expect(repos).toHaveLength(5);
    expect(repos.map((r) => r.repository_short_name)).toEqual([
      "demo-tiny",
      "demo-code",
      "demo-docs",
      "demo-media",
      "demo-large",
    ]);
    const files = repos.flatMap((r) => r.branches.flatMap((b) => b.files));
    const dirs = repos.flatMap((r) => r.branches.flatMap((b) => b.directories));
    expect(files.length).toBeGreaterThan(500);
    expect(dirs.length).toBeGreaterThan(0);
    expect(files[0]).toHaveProperty("name");
    expect(files[0].path.startsWith("./")).toBe(true);
  });

  it("includes Chinese filenames (pinyin-searchable)", () => {
    const names = buildDemoCorpus().flatMap((r) => r.branches.flatMap((b) => b.files.map((f) => f.name)));
    expect(names.some((n) => /[\u4e00-\u9fa5]/.test(n))).toBe(true);
  });
});
