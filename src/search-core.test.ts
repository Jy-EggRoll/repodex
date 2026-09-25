import { describe, expect, it } from "vitest";
import { search as tseSearch } from "text-search-engine";
import {
  PLAN_KEY,
  basename,
  decodeChunk,
  parsePlan,
  resolveSelection,
  runSearch,
  type KvGet,
  type SearchPlan,
  type SearchSpec,
} from "./search-core";

// ---------------- fixtures ----------------

interface BranchSpec {
  files: Array<[path: string, size: number]>;
  dirs: string[];
}
interface RepoSpec {
  full: string;
  branches: Record<string, BranchSpec>;
  t?: number;
}

const CORPUS: RepoSpec[] = [
  {
    full: "owner/alpha",
    branches: {
      dev: { files: [["README.md", 121]], dirs: [] },
      main: {
        files: [
          ["README.md", 120],
          ["src/index.ts", 900],
          ["src/deep/module.ts", 10],
          ["docs/a  b.txt", 5],
          ["说明文档.md", 7],
        ],
        dirs: ["src", "docs", "src/deep"],
      },
    },
  },
  {
    full: "owner/beta",
    branches: { main: { files: [["beta.txt", 20]], dirs: ["nested"] } },
  },
  {
    full: "owner/empty",
    branches: { main: { files: [], dirs: [] } },
  },
];

function planOf(
  specs: RepoSpec[],
  chunkSize: number,
): { plan: SearchPlan; chunkEntries: Record<string, unknown> } {
  const chunks: SearchPlan["chunks"] = [];
  const repos: SearchPlan["repos"] = [];
  const chunkEntries: Record<string, unknown> = {};
  for (const spec of specs) {
    let index = 0;
    let total = 0;
    for (const branchName of Object.keys(spec.branches).sort()) {
      const b = spec.branches[branchName]!;
      const items: Array<[number, string, number?]> = [
        ...b.files.map(([p, size]) => [0, p, size] as [number, string, number]),
        ...b.dirs.map((p) => [1, p] as [number, string]),
      ];
      for (let i = 0; i < items.length; i += chunkSize) {
        const slice = items.slice(i, i + chunkSize);
        const key = `${spec.full}@${index}`;
        chunks.push({ k: key, r: spec.full, b: branchName, n: slice.length });
        chunkEntries[key] = slice;
        index += 1;
        total += slice.length;
      }
    }
    const entry: SearchPlan["repos"][number] = { r: spec.full, n: total };
    if (spec.t !== undefined) entry.t = spec.t;
    repos.push(entry);
  }
  return { plan: { v: 3, chunks, repos, ts: 1 }, chunkEntries };
}

function kvFrom(entries: Record<string, unknown>): KvGet {
  const map = new Map<string, string>(Object.entries(entries).map(([k, v]) => [k, JSON.stringify(v)]));
  return async (k) => map.get(k) ?? null;
}

function world(
  specs: RepoSpec[],
  chunkSize = 2,
  opts: { dropChunk?: string; corruptChunk?: string; extra?: Record<string, unknown> } = {},
): KvGet {
  const { plan, chunkEntries } = planOf(specs, chunkSize);
  const entries: Record<string, unknown> = { [PLAN_KEY]: plan };
  for (const [k, v] of Object.entries(chunkEntries)) {
    if (k === opts.dropChunk) continue;
    entries[k] = k === opts.corruptChunk ? "not-an-array" : v;
  }
  for (const [k, v] of Object.entries(opts.extra ?? {})) entries[k] = v;
  return kvFrom(entries);
}

async function run(get: KvGet, params: Partial<SearchSpec>) {
  const out = await runSearch(get, { q: "", file: "", mode: "", limit: "", offset: "", ...params });
  return { status: out.status, body: JSON.parse(out.json) };
}

function withoutTimings(body: any) {
  const { tookMs, loadMs, searchMs, ...rest } = body;
  void tookMs;
  void loadMs;
  void searchMs;
  return rest;
}

// ---------------- tests ----------------

describe("basename", () => {
  it("strips path prefixes and keeps the file name", () => {
    expect(basename("./src/a.ts")).toBe("a.ts");
    expect(basename("说明.md")).toBe("说明.md");
    expect(basename("")).toBe("");
  });
});

describe("parsePlan", () => {
  it("rejects plans that are not v2/v3", () => {
    expect(parsePlan(null)).toBeNull();
    expect(parsePlan("not json")).toBeNull();
    expect(parsePlan(JSON.stringify({ v: 1, chunks: [], repos: [] }))).toBeNull();
    expect(parsePlan(JSON.stringify({ v: 4, chunks: [], repos: [] }))).toBeNull();
    expect(parsePlan(JSON.stringify({ v: 2, chunks: {}, repos: [] }))).toBeNull();
  });

  it("keeps valid entries and drops malformed ones", () => {
    const ok = parsePlan(
      JSON.stringify({
        v: 3,
        chunks: [{ k: "o/a@0", r: "o/a", b: "main", n: 3 }, { k: 1 }, null],
        repos: [{ r: "o/a", n: 3 }, "x"],
        ts: 5,
      }),
    );
    expect(ok).toEqual({
      v: 3,
      chunks: [{ k: "o/a@0", r: "o/a", b: "main", n: 3 }],
      repos: [{ r: "o/a", n: 3 }],
      ts: 5,
    });
  });

  it("still serves a v2 plan from before the migration (short-name keys, rs ignored)", () => {
    const ok = parsePlan(
      JSON.stringify({
        v: 2,
        chunks: [{ k: "a-index@0", r: "o/a", rs: "a", b: "main", n: 3 }],
        repos: [{ r: "o/a", rs: "a", n: 3 }],
      }),
    );
    expect(ok?.v).toBe(2);
    expect(ok?.chunks[0]).toMatchObject({ k: "a-index@0", r: "o/a", b: "main", n: 3 });
    expect(ok?.repos[0]).toMatchObject({ r: "o/a", n: 3 });
  });

  it("passes the optional recency timestamp through untouched", () => {
    const ok = parsePlan(JSON.stringify({ v: 3, chunks: [], repos: [{ r: "o/a", n: 1, t: 42 }] }));
    expect(ok?.repos).toEqual([{ r: "o/a", n: 1, t: 42 }]);
  });
});

describe("decodeChunk", () => {
  it("directories carry no size, files default a missing one", () => {
    const entries = decodeChunk(
      JSON.stringify([
        [0, "a.txt", 5],
        [1, "dir"],
        [0, "b.txt"],
      ]),
      "o/r",
      "main",
    );
    expect(entries).toEqual([
      { name: "a.txt", repository: "o/r", branch: "main", path: "a.txt", size: 5, type: "file" },
      { name: "dir", repository: "o/r", branch: "main", path: "dir", size: undefined, type: "directory" },
      { name: "b.txt", repository: "o/r", branch: "main", path: "b.txt", size: undefined, type: "file" },
    ]);
  });

  it("throws on malformed payloads so callers can count a load failure", () => {
    expect(() => decodeChunk(JSON.stringify({ nope: true }), "o/r", "main")).toThrow();
    expect(() => decodeChunk(JSON.stringify([[7, "x"]]), "o/r", "main")).toThrow();
  });
});

describe("resolveSelection", () => {
  const { plan } = planOf(CORPUS, 2);

  it("preserves the file-parameter quirks", () => {
    expect(resolveSelection("", plan)).toEqual({ kind: "all" });
    expect(resolveSelection(" ", plan)).toEqual({ kind: "all" });
    expect(resolveSelection("all", plan)).toEqual({ kind: "all" });
    expect(resolveSelection("ALL", plan)).toEqual({ kind: "invalid" });
    expect(resolveSelection("a/b/c", plan)).toEqual({ kind: "invalid" });
    expect(resolveSelection("no-slash", plan)).toEqual({ kind: "invalid" });
    expect(resolveSelection("a/b,c", plan)).toEqual({ kind: "list", names: ["a/b"] });
  });

  it("resolves plan-known single names to their chunks and dedupes list names", () => {
    const single = resolveSelection("owner/alpha", plan);
    expect(single.kind).toBe("single");
    if (single.kind === "single") {
      expect(single.known).toBe(true);
      expect(single.chunks.length).toBeGreaterThan(0);
    }
    expect(resolveSelection("owner/alpha,owner/alpha , owner/alpha", plan)).toEqual({
      kind: "list",
      names: ["owner/alpha"],
    });
    expect(resolveSelection("owner/missing", plan)).toEqual({
      kind: "single",
      name: "owner/missing",
      known: false,
      chunks: [],
    });
  });
});

describe("runSearch validation and selection", () => {
  it("empty query wins before anything else", async () => {
    const res = await run(kvFrom({}), { q: "  ", file: "no-slash" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "empty query" });
  });

  it("a missing plan reports index-not-ready (503) before any file validation", async () => {
    for (const file of ["", "all", "owner/alpha", "owner/alpha,owner/beta", "no-slash"]) {
      const res = await run(kvFrom({}), { q: "x", file });
      expect(res.status, `file=${file}`).toBe(503);
      expect(res.body).toEqual({ error: "index not ready, run Central Repository Index workflow first" });
    }
  });

  it("single names that are not owner/repo identifiers are invalid", async () => {
    for (const file of ["no-slash", "a/b/c", "a/"]) {
      const res = await run(world(CORPUS), { q: "x", file });
      expect(res.status, `file=${file}`).toBe(400);
      expect(res.body).toEqual({ error: "invalid file" });
    }
  });

  it("missing single index is 404 while a plan-known empty repo is 200", async () => {
    const get = world(CORPUS);
    expect((await run(get, { q: "x", file: "owner/nope" })).status).toBe(404);
    expect((await run(get, { q: "x", file: "ALL" })).status).toBe(400);
    const empty = await run(get, { q: "x", file: "owner/empty" });
    expect(empty.status).toBe(200);
    expect(empty.body.total).toBe(0);
    expect(empty.body.itemsTotal).toBe(0);
  });

  it("stray keys in KV outside the plan are invisible", async () => {
    const get = world(CORPUS, 2, {
      extra: {
        "ghost-index": { repository: "o/ghost", branches: [] },
        "owner/alpha": { repository: "o/alpha", branches: [] },
      },
    });
    expect((await run(get, { q: "x", file: "o/ghost" })).status).toBe(404);
    const all = await run(get, { q: "ghost" });
    expect(all.body.total).toBe(0);
    // the plan wins for real repos even when a same-named key exists
    const alpha = await run(get, { q: "readme", file: "owner/alpha" });
    expect(alpha.body.total).toBeGreaterThan(0);
  });

  it("comma lists silently drop invalid and unknown names and never 404", async () => {
    const get = world(CORPUS);
    const res = await run(get, {
      q: "readme",
      file: "owner/alpha,bad/name,no-slash,owner/missing,owner/beta",
    });
    expect(res.status).toBe(200);
    const both = await run(get, { q: "readme", file: "owner/alpha,owner/beta" });
    expect(withoutTimings(res.body)).toEqual(withoutTimings(both.body));

    const unknownOnly = await run(get, { q: "readme", file: "owner/missing,owner/nope" });
    expect(unknownOnly.status).toBe(200);
    expect(unknownOnly.body.total).toBe(0);
  });

  it("limit and offset quirks", async () => {
    const get = world(CORPUS);
    const full = await run(get, { q: "e" });
    expect(full.body.total).toBeGreaterThan(1);

    const one = await run(get, { q: "e", limit: "1" });
    expect(one.body.results.length).toBe(1);
    expect(one.body.total).toBe(full.body.total);

    const offset = await run(get, { q: "e", offset: "1" });
    expect(offset.body.results[0]).toEqual(full.body.results[1]);

    const negative = await run(get, { q: "e", offset: "-3" });
    expect(negative.body.results[0]).toEqual(full.body.results[0]);
  });
});

describe("migration window", () => {
  it("a v2 plan (short-name chunk keys) is served with full-name selection", async () => {
    const v2plan = {
      v: 2,
      chunks: [{ k: "alpha-index@0", r: "owner/alpha", rs: "alpha", b: "main", n: 1 }],
      repos: [{ r: "owner/alpha", rs: "alpha", n: 1 }],
    };
    const get = kvFrom({ [PLAN_KEY]: v2plan, "alpha-index@0": [[0, "README.md", 1]] });
    const res = await run(get, { q: "readme", file: "owner/alpha" });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.results[0].path).toBe("README.md");
  });
});

describe("repo-level recency", () => {
  const day = 86400000;
  const now = Date.now();
  const FRESH_STALE: RepoSpec[] = [
    {
      full: "owner/old",
      t: now - 400 * day,
      branches: { main: { files: [["notes.txt", 10]], dirs: [] } },
    },
    {
      full: "owner/new",
      t: now,
      branches: { main: { files: [["notes.txt", 10]], dirs: [] } },
    },
  ];

  it("a freshly pushed repository floats above an otherwise equal stale one", async () => {
    const res = await run(world(FRESH_STALE), { q: "notes.txt" });
    expect(res.body.results.map((r: any) => r.repository)).toEqual(["owner/new", "owner/old"]);
  });

  it("plans without timestamps keep the scan order (boost is neutral)", async () => {
    const stripped = FRESH_STALE.map((s) => ({ full: s.full, branches: s.branches }));
    const res = await run(world(stripped), { q: "notes.txt" });
    expect(res.body.results.map((r: any) => r.repository)).toEqual(["owner/old", "owner/new"]);
  });
});

describe("runSearch result shape", () => {
  it("the page keeps the historical field order and directory shape", async () => {
    const res = await run(world(CORPUS), { q: "deep", file: "owner/alpha" });
    const file = res.body.results.find((r: any) => r.type === "file");
    const dir = res.body.results.find((r: any) => r.type === "directory");

    expect(Object.keys(file)).toEqual([
      "name",
      "repository",
      "branch",
      "path",
      "size",
      "size_mb",
      "type",
      "github_url",
      "highlightedPath",
    ]);
    expect(file.github_url).toBe("https://github.com/owner/alpha/blob/main/src/deep/module.ts");
    expect(file.size_mb).toBe(0);

    expect(dir.path).toBe("src/deep");
    expect("size" in dir).toBe(false);
    expect(dir.github_url).toBe("https://github.com/owner/alpha/tree/main/src/deep");
  });

  it("mode=name highlights names only and vice versa", async () => {
    const byName = await run(world(CORPUS), { q: "readme", mode: "name" });
    const named = byName.body.results[0];
    expect(named.highlightedName).toContain("<mark>");
    expect("highlightedPath" in named).toBe(false);

    const byPath = await run(world(CORPUS), { q: "readme" });
    const pathed = byPath.body.results[0];
    expect(pathed.highlightedPath).toContain("<mark>");
    expect("highlightedName" in pathed).toBe(false);
  });
});

describe("runSearch telemetry and failures", () => {
  it("exactly SCORE_CAP matches mark the total as truncated", async () => {
    const files = Array.from(
      { length: 1000 },
      (_, i) => [`match-${String(i).padStart(4, "0")}.txt`, 1] as [string, number],
    );
    const spec = { full: "o/many", branches: { main: { files, dirs: [] } } };
    const res = await run(world([spec], 300), { q: "match" });
    expect(res.body.total).toBe(1000);
    expect(res.body.truncated).toBe(true);
  });

  it("just below the cap is not truncated", async () => {
    const files = Array.from({ length: 999 }, (_, i) => [`match-${i}.txt`, 1] as [string, number]);
    const spec = { full: "o/many", branches: { main: { files, dirs: [] } } };
    const res = await run(world([spec], 300), { q: "match" });
    expect(res.body.total).toBe(999);
    expect(res.body.truncated).toBe(false);
  });

  it("a cap stop still reports the full corpus from the plan (load-everything parity)", async () => {
    const files = Array.from({ length: 2400 }, (_, i) => [`match-${i}.txt`, 1] as [string, number]);
    const spec = { full: "o/many", branches: { main: { files, dirs: [] } } };
    const res = await run(world([spec], 100), { q: "match" });
    expect(res.body.truncated).toBe(true);
    expect(res.body.total).toBe(1000);
    expect(res.body.itemsTotal).toBe(2400);
    expect(res.body.indexCount).toBe(1);
  });

  it("a plan-promised but missing chunk counts as a load failure and keeps partial results", async () => {
    const spec: RepoSpec = {
      full: "o/x",
      branches: {
        main: {
          files: [
            ["a.txt", 1],
            ["b.txt", 1],
            ["c.txt", 1],
          ],
          dirs: [],
        },
      },
    };
    const res = await run(world([spec], 1, { dropChunk: "o/x@1" }), { q: "txt" });
    expect(res.status).toBe(200);
    expect(res.body.loadFailCount).toBe(1);
    expect(res.body.itemsTotal).toBe(2);
    expect(res.body.total).toBe(2);
  });

  it("a chunk that fails to decode counts as a load failure and keeps partial results", async () => {
    const spec: RepoSpec = {
      full: "o/x",
      branches: {
        main: {
          files: [
            ["a.txt", 1],
            ["b.txt", 1],
            ["c.txt", 1],
          ],
          dirs: [],
        },
      },
    };
    const res = await run(world([spec], 1, { corruptChunk: "o/x@1" }), { q: "txt" });
    expect(res.status).toBe(200);
    expect(res.body.loadFailCount).toBe(1);
    expect(res.body.itemsTotal).toBe(2);
    expect(res.body.total).toBe(2);
  });
});

describe("prefilter never hides real matches", () => {
  it("runSearch finds exactly what a raw library scan finds", async () => {
    const paths: string[] = [];
    for (const spec of CORPUS) {
      for (const name of Object.keys(spec.branches).sort()) {
        const b = spec.branches[name]!;
        paths.push(...b.files.map(([p]) => p), ...b.dirs);
      }
    }
    const queries = ["e", "READ", "zzz", "说明", "sm", "a b", "文档", "全角", "🚀", "t.s"];
    for (const q of queries) {
      const reference = paths.filter((p) => tseSearch(p, q)).sort();
      const res = await run(world(CORPUS), { q, limit: "1000" });
      const got = res.body.results.map((r: any) => r.path).sort();
      expect(got, `q=${q}`).toEqual(reference);
    }
  });
});
