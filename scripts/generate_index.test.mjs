import { describe, expect, it } from "vitest";
import {
  buildBranch,
  buildChunkWrites,
  computePruneList,
  encodeChunk,
  needsUpdate,
  parseBlocklist,
  shouldSkip,
} from "./generate_index.mjs";

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
  it("skips only when SHAs match, the key exists, and the stored format is current", () => {
    expect(shouldSkip({ main: "aaa" }, { main: "aaa" }, true, true)).toBe(true);
  });

  it("rebuilds when SHAs match but the key is missing (prevents silently missing indexes)", () => {
    expect(shouldSkip({ main: "aaa" }, { main: "aaa" }, false, true)).toBe(false);
  });

  it("rebuilds when SHAs change", () => {
    expect(shouldSkip({ main: "aaa" }, { main: "bbb" }, true, true)).toBe(false);
  });

  it("rebuilds everything when the stored format is outdated", () => {
    expect(shouldSkip({ main: "aaa" }, { main: "aaa" }, true, false)).toBe(false);
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

describe("encodeChunk", () => {
  it("strips the ./ prefix, keeps file sizes, and omits directory sizes", () => {
    expect(
      encodeChunk([
        { type: "file", path: "./src/a.ts", size: 120 },
        { type: "directory", path: "./src" },
      ]),
    ).toEqual([
      [0, "src/a.ts", 120],
      [1, "src"],
    ]);
  });

  it("missing file size still lands as 0", () => {
    expect(encodeChunk([{ type: "file", path: "./a" }])).toEqual([[0, "a", 0]]);
  });
});

describe("buildChunkWrites", () => {
  const repo = { fullName: "o/r", shortName: "r" };

  it("chunks stay inside one branch and slice at the item cap", () => {
    const files = Array.from({ length: 20001 }, (_, i) => ({ path: `./f${i}`, size: i }));
    const branchesData = [
      { branch_name: "main", files, directories: [] },
      {
        branch_name: "dev",
        files: [{ name: "d", path: "./d", size: 1 }],
        directories: [{ name: "dir", path: "./dir" }],
      },
    ];
    const { chunks, repo: ref } = buildChunkWrites(repo, branchesData);

    expect(chunks.map((c) => [c.key, c.branch, c.n])).toEqual([
      ["r-index@0", "main", 20000],
      ["r-index@1", "main", 1],
      ["r-index@2", "dev", 2],
    ]);
    expect(ref).toEqual({ r: "o/r", rs: "r", n: 20003 });
    expect(chunks[0].value[0]).toEqual([0, "f0", 0]);
    expect(chunks[1].value[0]).toEqual([0, "f20000", 20000]);
    expect(chunks[2].value[1]).toEqual([1, "dir"]);
  });

  it("file items precede directory items within a branch", () => {
    const { chunks } = buildChunkWrites(repo, [
      {
        branch_name: "main",
        files: [{ name: "a", path: "./a", size: 1 }],
        directories: [{ name: "b", path: "./b" }],
      },
    ]);
    expect(chunks[0].value).toEqual([
      [0, "a", 1],
      [1, "b"],
    ]);
  });

  it("an empty repository yields no chunks but keeps a repo ref", () => {
    const { chunks, repo: ref } = buildChunkWrites(repo, [
      { branch_name: "main", files: [], directories: [] },
    ]);
    expect(chunks).toEqual([]);
    expect(ref).toEqual({ r: "o/r", rs: "r", n: 0 });
  });
});

describe("computePruneList", () => {
  it("deletes stale chunks and envelopes, keeps planned keys, and never touches __meta-*", () => {
    const existing = [
      "r1-index",
      "r1-index@0",
      "r1-index@9",
      "r2-index",
      "r2-index@0",
      "__meta-plan",
      "__meta-sha-table",
    ];
    const prune = computePruneList(existing, [{ k: "r1-index@0" }], ["r1-index"]);
    expect(prune).toEqual(["r1-index@9", "r2-index", "r2-index@0"]);
  });

  it("leaves unrelated keys alone", () => {
    expect(computePruneList(["repo-info-cache", "other", "__meta-plan"], [], [])).toEqual([]);
  });

  it("REPOS_ONLY-style calls with nothing discovered prune everything else, so main() must guard the call", () => {
    // Documents the blast radius: this is exactly why single-repo runs never call computePruneList
    expect(computePruneList(["a-index", "b-index@0"], [], [])).toEqual(["a-index", "b-index@0"]);
  });
});
