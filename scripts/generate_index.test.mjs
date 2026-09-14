import { describe, expect, it } from "vitest";
import { buildBranch, needsUpdate, parseBlocklist, shouldSkip } from "./generate_index.mjs";

describe("parseBlocklist", () => {
  it("ignores comments, blank lines, and surrounding whitespace", () => {
    expect(parseBlocklist("# comment\n\no/a  \n  o/b\n")).toEqual(new Set(["o/a", "o/b"]));
  });

  it("empty file yields an empty set", () => {
    expect(parseBlocklist("")).toEqual(new Set());
  });
});

describe("needsUpdate", () => {
  it("identical tables need no update", () => {
    expect(needsUpdate({ main: "aaa" }, { main: "aaa" })).toBe(false);
  });

  it("sha changes, branch additions/removals, and first record all need an update", () => {
    expect(needsUpdate({ main: "aaa" }, { main: "bbb" })).toBe(true);
    expect(needsUpdate({ main: "aaa" }, { main: "aaa", dev: "ccc" })).toBe(true);
    expect(needsUpdate(undefined, { main: "aaa" })).toBe(true);
  });
});

describe("shouldSkip", () => {
  it("skips only when SHAs match and the key exists", () => {
    expect(shouldSkip({ main: "aaa" }, { main: "aaa" }, true)).toBe(true);
  });

  it("rebuilds when SHAs match but the key is missing (prevents silently missing indexes)", () => {
    expect(shouldSkip({ main: "aaa" }, { main: "aaa" }, false)).toBe(false);
  });

  it("rebuilds when SHAs change", () => {
    expect(shouldSkip({ main: "aaa" }, { main: "bbb" }, true)).toBe(false);
  });
});

describe("buildBranch", () => {
  it("blobs go to files, trees to directories, paths get a ./ prefix", () => {
    const branch = buildBranch("main", [
      { path: "src/a.ts", type: "blob", size: 10 },
      { path: "src", type: "tree" },
      { path: "", type: "blob", size: 1 },
    ]);
    expect(branch).toEqual({
      branch_name: "main",
      files: [{ name: "a.ts", path: "./src/a.ts", size: 10 }],
      directories: [{ name: "src", path: "./src" }],
    });
  });

  it("missing size defaults to 0", () => {
    const branch = buildBranch("main", [{ path: "a", type: "blob" }]);
    expect(branch.files[0].size).toBe(0);
  });
});
