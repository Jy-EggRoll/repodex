import { describe, expect, it, vi } from "vitest";
import {
  attachPushedAt,
  buildBranchItems,
  buildChunkWrites,
  cfKvList,
  computePruneList,
  encodeChunk,
  needsUpdate,
  parseBlocklist,
  shouldSkip,
  buildRepoInfo,
  withRetry,
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
  it("skips only when SHAs match, the repo has index data, and the stored format is current", () => {
    expect(shouldSkip({ main: "aaa" }, { main: "aaa" }, true, true)).toBe(true);
  });

  it("rebuilds when SHAs match but the repo has no index data (prevents silently missing indexes)", () => {
    expect(shouldSkip({ main: "aaa" }, { main: "aaa" }, false, true)).toBe(false);
  });

  it("rebuilds when SHAs change", () => {
    expect(shouldSkip({ main: "aaa" }, { main: "bbb" }, true, true)).toBe(false);
  });

  it("rebuilds everything when the stored format is outdated", () => {
    expect(shouldSkip({ main: "aaa" }, { main: "aaa" }, true, false)).toBe(false);
  });
});

describe("buildBranchItems", () => {
  it("blobs become file items and trees become directory items after them", () => {
    const branch = buildBranchItems("main", [
      { path: "src/a.ts", type: "blob", size: 10 },
      { path: "src", type: "tree" },
      { path: "", type: "blob", size: 1 },
    ]);
    expect(branch).toEqual({
      branch: "main",
      items: [
        { type: "file", path: "src/a.ts", size: 10 },
        { type: "directory", path: "src" },
      ],
    });
  });

  it("missing size defaults to 0", () => {
    const branch = buildBranchItems("main", [{ path: "a", type: "blob" }]);
    expect(branch.items[0].size).toBe(0);
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
  const repo = { fullName: "o/r" };

  it("chunks stay inside one branch and slice at the item cap", () => {
    const items = Array.from({ length: 20001 }, (_, i) => ({ type: "file", path: `f${i}`, size: i }));
    const branches = [
      { branch: "main", items },
      {
        branch: "dev",
        items: [
          { type: "file", path: "d", size: 1 },
          { type: "directory", path: "dir" },
        ],
      },
    ];
    const { chunks, repo: ref } = buildChunkWrites(repo, branches);

    expect(chunks.map((c) => [c.key, c.branch, c.n])).toEqual([
      ["o/r@0", "main", 20000],
      ["o/r@1", "main", 1],
      ["o/r@2", "dev", 2],
    ]);
    expect(ref).toEqual({ r: "o/r", n: 20003 });
    expect(chunks[0].value[0]).toEqual([0, "f0", 0]);
    expect(chunks[1].value[0]).toEqual([0, "f20000", 20000]);
    expect(chunks[2].value[1]).toEqual([1, "dir"]);
  });

  it("file items precede directory items within a branch", () => {
    const branches = [
      buildBranchItems("main", [
        { path: "b", type: "tree" },
        { path: "a", type: "blob", size: 1 },
      ]),
    ];
    const { chunks } = buildChunkWrites(repo, branches);
    expect(chunks[0].value).toEqual([
      [0, "a", 1],
      [1, "b"],
    ]);
  });

  it("an empty repository yields no chunks but keeps a repo ref", () => {
    const { chunks, repo: ref } = buildChunkWrites(repo, [{ branch: "main", items: [] }]);
    expect(chunks).toEqual([]);
    expect(ref).toEqual({ r: "o/r", n: 0 });
  });
});

describe("attachPushedAt", () => {
  it("fills t from the map and keeps a previously stored value on a map miss", () => {
    const map = new Map([["o/a", 111]]);
    expect(attachPushedAt([{ r: "o/a", n: 3 }], map)).toEqual([{ r: "o/a", n: 3, t: 111 }]);
    expect(attachPushedAt([{ r: "o/b", n: 3, t: 222 }], map)).toEqual([{ r: "o/b", n: 3, t: 222 }]);
  });

  it("does not mutate the input and tolerates a missing list", () => {
    const input = [{ r: "o/a", n: 1 }];
    attachPushedAt(input, new Map([["o/a", 5]]));
    expect(input).toEqual([{ r: "o/a", n: 1 }]);
    expect(attachPushedAt(undefined, new Map())).toEqual([]);
  });
});

describe("computePruneList", () => {
  it("deletes stale chunks (current and retired formats) and every bare envelope, keeps planned chunks, and never touches __meta-*", () => {
    const existing = [
      "legacy-index",
      "legacy-index@0",
      "o/r1@0",
      "o/r1@9",
      "o/r2@0",
      "__meta-plan",
      "__meta-sha-table",
    ];
    const prune = computePruneList(existing, [{ k: "o/r1@0" }]);
    expect(prune).toEqual(["legacy-index", "legacy-index@0", "o/r1@9", "o/r2@0"]);
  });

  it("leaves unrelated keys alone", () => {
    expect(computePruneList(["repo-info-cache", "other", "__meta-plan"], [])).toEqual([]);
  });

  it("REPOS_ONLY-style calls with nothing planned prune everything else, so main() must guard the call", () => {
    // Documents the blast radius: this is exactly why single-repo runs never call computePruneList
    expect(computePruneList(["o/a@0", "o/b@0"], [])).toEqual(["o/a@0", "o/b@0"]);
  });
});

describe("withRetry", () => {
  it("retries retryable failures until success", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error("transient");
        return "ok";
      },
      { tries: 5, baseMs: 1 },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("fails fast on a non-retryable error", async () => {
    let calls = 0;
    const fatal = new Error("fatal");
    fatal.retryable = false;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw fatal;
        },
        { tries: 5, baseMs: 1 },
      ),
    ).rejects.toThrow("fatal");
    expect(calls).toBe(1);
  });

  it("throws the last error after exhausting every try", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new Error("always");
        },
        { tries: 2, baseMs: 1 },
      ),
    ).rejects.toThrow("always");
    expect(calls).toBe(2);
  });
});

describe("cfKvList", () => {
  it("follows the cursor until the list is complete", async () => {
    const pages = [
      { success: true, result: [{ name: "a" }], result_info: { cursor: "cursor-1" } },
      { success: true, result: [{ name: "b" }], result_info: { list_complete: true } },
    ];
    const calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        calls.push(String(url));
        return { ok: true, status: 200, json: async () => pages[calls.length - 1] };
      }),
    );
    try {
      expect(await cfKvList("acct", "ns", "token")).toEqual(["a", "b"]);
      expect(calls).toHaveLength(2);
      expect(calls[0]).toContain("limit=1000");
      expect(calls[0]).not.toContain("cursor=");
      expect(calls[1]).toContain("cursor=cursor-1");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("also pages when only a cursor is returned, stopping on an absent one", async () => {
    const pages = [
      { success: true, result: [{ name: "a" }], result_info: { cursor: "c1" } },
      { success: true, result: [{ name: "b" }], result_info: {} },
    ];
    let i = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => pages[i++] })),
    );
    try {
      expect(await cfKvList("acct", "ns", "token")).toEqual(["a", "b"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("buildRepoInfo", () => {
  it("includes full_name from repo data", () => {
    const repos = [
      {
        name: "repo-a",
        full_name: "owner/repo-a",
        size: 819200,
        description: null,
        html_url: "https://github.com/owner/repo-a",
      },
    ];
    const result = buildRepoInfo(repos);
    expect(result[0].full_name).toBe("owner/repo-a");
  });

  it("skips repos without a valid name", () => {
    const repos = [
      { name: "", full_name: "", size: 100, description: null, html_url: "" },
      { name: "valid", full_name: "owner/valid", size: 200, description: null, html_url: "" },
    ];
    expect(buildRepoInfo(repos)).toHaveLength(1);
  });

  it("handles undefined repos", () => {
    expect(buildRepoInfo(undefined)).toEqual([]);
  });
});
