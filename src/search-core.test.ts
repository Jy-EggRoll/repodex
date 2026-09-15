import { describe, expect, it } from "vitest";
import { search as tseSearch } from "text-search-engine";
import {
  PLAN_KEY,
  basename,
  canMaybeMatch,
  decodeChunk,
  parsePlan,
  resolveSelection,
  runSearch,
  targetLength,
  type KvReader,
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
  short: string;
  branches: Record<string, BranchSpec>;
}

const CORPUS: RepoSpec[] = [
  {
    full: "owner/alpha",
    short: "alpha",
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
    short: "beta",
    branches: { main: { files: [["beta.txt", 20]], dirs: ["nested"] } },
  },
  {
    full: "owner/empty",
    short: "empty",
    branches: { main: { files: [], dirs: [] } },
  },
];

function buildEnvelope(spec: RepoSpec) {
  const branches = Object.keys(spec.branches)
    .sort()
    .map((name) => {
      const b = spec.branches[name]!;
      return {
        branch_name: name,
        files: b.files.map(([p, size]) => ({ name: p.split("/").pop()!, path: `./${p}`, size })),
        directories: b.dirs.map((p) => ({ name: p.split("/").pop()!, path: `./${p}` })),
      };
    });
  return { repository: spec.full, repository_short_name: spec.short, branches };
}

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
        const key = `${spec.short}-index@${index}`;
        chunks.push({ k: key, r: spec.full, rs: spec.short, b: branchName, n: slice.length });
        chunkEntries[key] = slice;
        index += 1;
        total += slice.length;
      }
    }
    repos.push({ r: spec.full, rs: spec.short, n: total });
  }
  return { plan: { v: 2, chunks, repos, ts: 1 }, chunkEntries };
}

function kvFrom(entries: Record<string, unknown>): KvReader {
  const map = new Map<string, string>(Object.entries(entries).map(([k, v]) => [k, JSON.stringify(v)]));
  return { get: async (k) => map.get(k) ?? null, list: async () => [...map.keys()] };
}

function legacyWorld(specs: RepoSpec[]): KvReader {
  const entries: Record<string, unknown> = {};
  for (const s of specs) entries[`${s.short}-index`] = buildEnvelope(s);
  return kvFrom(entries);
}

function v2World(specs: RepoSpec[], chunkSize = 2, opts: { dropChunk?: string } = {}): KvReader {
  const { plan, chunkEntries } = planOf(specs, chunkSize);
  const entries: Record<string, unknown> = { [PLAN_KEY]: plan };
  for (const [k, v] of Object.entries(chunkEntries)) {
    if (k !== opts.dropChunk) entries[k] = v;
  }
  // Dual-write realism: envelopes exist in the v2 world too and must be ignored when the plan covers them
  for (const s of specs) entries[`${s.short}-index`] = buildEnvelope(s);
  return kvFrom(entries);
}

async function run(kv: KvReader, params: Partial<SearchSpec>) {
  const out = await runSearch(kv, { q: "", file: "", mode: "", limit: "", offset: "", ...params });
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

describe("canMaybeMatch soundness", () => {
  const pairs: Array<[string, string]> = [
    ["readme", "README.md"],
    ["rsp", "src/README.md"],
    ["zzz", "src/index.ts"],
    ["SM", "说明.md"],
    ["sm", "说明文档.md"],
    ["拼音", "说明文档.md"],
    ["a b", "docs/a  b.txt"],
    ["a b", "docs/a b.txt"],
    ["a\u00a0b", "docs/a b.txt"],
    ["md", "说明.md"],
    ["全角", "ｆｕｌｌｗｉｄｔｈ.txt"],
    ["TM", "README.md"],
  ];

  it("a negative prefilter verdict always means the library finds nothing", () => {
    for (const [q, t] of pairs) {
      if (!canMaybeMatch(q, t)) {
        expect(tseSearch(t, q), `q=${q} target=${t}`).toBeUndefined();
      }
    }
  });

  it("defers to the library for non-ASCII targets (pinyin/space semantics)", () => {
    expect(canMaybeMatch("SM", "说明.md")).toBe(true);
    expect(canMaybeMatch("a b", "docs/a  b.txt")).toBe(true);
    expect(canMaybeMatch("md", "说明.md")).toBe(true);
  });

  it("plain ASCII still gets the fast path", () => {
    expect(canMaybeMatch("zzz", "src/index.ts")).toBe(false);
    expect(canMaybeMatch("readme", "README.md")).toBe(true);
  });

  it("targetLength counts code points, basename strips prefixes", () => {
    expect(targetLength("abc")).toBe(3);
    expect(targetLength("🚀🚀")).toBe(2);
    expect(basename("./src/a.ts")).toBe("a.ts");
    expect(basename("说明.md")).toBe("说明.md");
    expect(basename("")).toBe("");
  });
});

describe("parsePlan", () => {
  it("rejects anything that is not a v2 plan", () => {
    expect(parsePlan(null)).toBeNull();
    expect(parsePlan("not json")).toBeNull();
    expect(parsePlan(JSON.stringify({ v: 1, chunks: [], repos: [] }))).toBeNull();
    expect(parsePlan(JSON.stringify({ v: 2, chunks: {}, repos: [] }))).toBeNull();
  });

  it("keeps valid entries and drops malformed ones", () => {
    const ok = parsePlan(
      JSON.stringify({
        v: 2,
        chunks: [{ k: "a-index@0", r: "o/a", rs: "a", b: "main", n: 3 }, { k: 1 }, null],
        repos: [{ r: "o/a", rs: "a", n: 3 }, "x"],
        ts: 5,
      }),
    );
    expect(ok).toEqual({
      v: 2,
      chunks: [{ k: "a-index@0", r: "o/a", rs: "a", b: "main", n: 3 }],
      repos: [{ r: "o/a", rs: "a", n: 3 }],
      ts: 5,
    });
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
    expect(resolveSelection("ALL", plan)).toEqual({ kind: "single", name: "ALL", known: false, chunks: [] });
    expect(resolveSelection("a/b", plan)).toEqual({ kind: "invalid" });
    expect(resolveSelection("a..b", plan)).toEqual({ kind: "invalid" });
    expect(resolveSelection("a/b,c", plan)).toEqual({ kind: "list", names: ["c"] });
  });

  it("resolves plan-known single names to their chunks and dedupes list names", () => {
    const single = resolveSelection("alpha-index", plan);
    expect(single.kind).toBe("single");
    if (single.kind === "single") {
      expect(single.known).toBe(true);
      expect(single.chunks.length).toBeGreaterThan(0);
    }
    expect(resolveSelection("alpha-index,alpha-index , alpha-index", plan)).toEqual({
      kind: "list",
      names: ["alpha-index"],
    });
    expect(resolveSelection("missing-index", plan)).toEqual({
      kind: "single",
      name: "missing-index",
      known: false,
      chunks: [],
    });
  });
});

describe("runSearch validation and selection", () => {
  it("empty query wins before anything else", async () => {
    const res = await run(kvFrom({}), { q: "  ", file: "bad/name" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "empty query" });
  });

  it("single names containing .. or / are invalid", async () => {
    const res = await run(kvFrom({}), { q: "x", file: "a/b" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid file" });
  });

  it("missing single index is 404 while an existing empty one is 200", async () => {
    expect((await run(legacyWorld(CORPUS), { q: "x", file: "nope-index" })).status).toBe(404);
    expect((await run(legacyWorld(CORPUS), { q: "x", file: "ALL" })).status).toBe(404);
    const empty = await run(legacyWorld(CORPUS), { q: "x", file: "empty-index" });
    expect(empty.status).toBe(200);
    expect(empty.body.total).toBe(0);
  });

  it("plan-known empty repository is 200, not 404", async () => {
    const res = await run(v2World(CORPUS), { q: "x", file: "empty-index" });
    expect(res.status).toBe(200);
    expect(res.body.itemsTotal).toBe(0);
  });

  it("comma lists silently drop invalid names and never 404", async () => {
    const res = await run(v2World(CORPUS), { q: "readme", file: "alpha-index,bad/name,..,beta-index" });
    expect(res.status).toBe(200);
    const legacy = await run(legacyWorld(CORPUS), { q: "readme", file: "alpha-index,beta-index" });
    expect(withoutTimings(res.body).total).toBe(withoutTimings(legacy.body).total);
  });

  it("limit and offset quirks", async () => {
    const full = await run(legacyWorld(CORPUS), { q: "e" });
    expect(full.body.total).toBeGreaterThan(1);

    const one = await run(legacyWorld(CORPUS), { q: "e", limit: "1" });
    expect(one.body.results.length).toBe(1);
    expect(one.body.total).toBe(full.body.total);

    const offset = await run(legacyWorld(CORPUS), { q: "e", offset: "1" });
    expect(offset.body.results[0]).toEqual(full.body.results[1]);

    const negative = await run(legacyWorld(CORPUS), { q: "e", offset: "-3" });
    expect(negative.body.results[0]).toEqual(full.body.results[0]);
  });
});

describe("runSearch output parity between formats", () => {
  it("chunked world deep-equals the legacy world across parameter variants", async () => {
    const variants: Array<Partial<SearchSpec>> = [
      { q: "md" },
      { q: "e", mode: "name" },
      { q: "readme", file: "alpha-index" },
      { q: "说明", file: "alpha-index" },
      { q: "readme", file: "alpha-index,beta-index" },
      { q: "readme", file: "alpha-index,alpha-index" },
      { q: "e", offset: "1", limit: "1" },
      { q: "x", file: "empty-index" },
    ];
    for (const params of variants) {
      const legacy = await run(legacyWorld(CORPUS), params);
      const v2 = await run(v2World(CORPUS), params);
      expect(v2.status, JSON.stringify(params)).toBe(legacy.status);
      expect(withoutTimings(v2.body), JSON.stringify(params)).toEqual(withoutTimings(legacy.body));
    }
  });

  it("the page keeps the historical field order and directory shape", async () => {
    const res = await run(legacyWorld(CORPUS), { q: "deep", file: "alpha-index" });
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
      "ranges",
      "score",
      "highlightedPath",
    ]);
    expect(file.github_url).toBe("https://github.com/owner/alpha/blob/main/src/deep/module.ts");
    expect(file.size_mb).toBe(0);

    expect(dir.path).toBe("src/deep");
    expect("size" in dir).toBe(false);
    expect(dir.github_url).toBe("https://github.com/owner/alpha/tree/main/src/deep");
  });

  it("mode=name highlights names only and vice versa", async () => {
    const byName = await run(legacyWorld(CORPUS), { q: "readme", mode: "name" });
    const named = byName.body.results[0];
    expect(named.highlightedName).toContain("<mark>");
    expect("highlightedPath" in named).toBe(false);

    const byPath = await run(legacyWorld(CORPUS), { q: "readme" });
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
    const spec = { full: "o/many", short: "many", branches: { main: { files, dirs: [] } } };
    const res = await run(v2World([spec], 300), { q: "match" });
    expect(res.body.total).toBe(1000);
    expect(res.body.truncated).toBe(true);
  });

  it("just below the cap is not truncated", async () => {
    const files = Array.from({ length: 999 }, (_, i) => [`match-${i}.txt`, 1] as [string, number]);
    const spec = { full: "o/many", short: "many", branches: { main: { files, dirs: [] } } };
    const res = await run(v2World([spec], 300), { q: "match" });
    expect(res.body.total).toBe(999);
    expect(res.body.truncated).toBe(false);
  });

  it("a cap stop still reports the full corpus from the plan (load-everything parity)", async () => {
    const files = Array.from({ length: 2400 }, (_, i) => [`match-${i}.txt`, 1] as [string, number]);
    const spec = { full: "o/many", short: "many", branches: { main: { files, dirs: [] } } };
    const res = await run(v2World([spec], 100), { q: "match" });
    expect(res.body.truncated).toBe(true);
    expect(res.body.total).toBe(1000);
    expect(res.body.itemsTotal).toBe(2400);
    expect(res.body.indexCount).toBe(1);
  });

  it("a plan-promised but missing chunk counts as a load failure and keeps partial results", async () => {
    const spec: RepoSpec = {
      full: "o/x",
      short: "x",
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
    const res = await run(v2World([spec], 1, { dropChunk: "x-index@1" }), { q: "txt" });
    expect(res.status).toBe(200);
    expect(res.body.loadFailCount).toBe(1);
    expect(res.body.itemsTotal).toBe(2);
    expect(res.body.total).toBe(2);
  });

  it("a broken legacy envelope is skipped silently in whole-corpus mode but 500s in single mode", async () => {
    const kv = kvFrom({ "a-index": { repository: "o/a", branches: [null] } });
    const all = await run(kv, { q: "x" });
    expect(all.status).toBe(200);
    expect(all.body.loadFailCount).toBe(1);

    const single = await run(kv, { q: "x", file: "a-index" });
    expect(single.status).toBe(500);
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
      const res = await run(legacyWorld(CORPUS), { q, limit: "1000" });
      const got = res.body.results.map((r: any) => r.path).sort();
      expect(got, `q=${q}`).toEqual(reference);
    }
  });
});
