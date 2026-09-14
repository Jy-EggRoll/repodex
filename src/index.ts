import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { basicAuth } from "hono/basic-auth";
import { prettyJSON } from "hono/pretty-json";
import { search as tseSearch } from "text-search-engine";
import { chunk } from "./batch";
import { buildHighlighted } from "./highlight";
import { compareRank, rankKeyFromRanges, type RankKey } from "./rank";

type Bindings = {
  public_assets: Fetcher;
  repo_index_kv: KVNamespace;
  USER: string;
  PSWD: string;
};

interface IndexFile {
  name: string;
  path: string;
  size: number;
}

interface IndexDirectory {
  name: string;
  path: string;
}

interface IndexBranch {
  branch_name: string;
  files: IndexFile[];
  directories: IndexDirectory[];
}

interface IndexJson {
  repository: string;
  repository_short_name: string;
  branches: IndexBranch[];
}

interface RepoInfo {
  name: string;
  size: number;
  size_mb: number;
  risk: "safe" | "warn" | "danger";
  description: string | null;
  html_url: string;
}

interface SearchItem {
  name: string;
  repository: string;
  branch: string;
  path: string;
  size: number | undefined;
  github_url: string | undefined;
  type: "file" | "directory";
}

interface SearchResult {
  name: string;
  repository: string;
  branch: string;
  path: string;
  size: number | undefined;
  size_mb: number;
  type: "file" | "directory";
  github_url: string | undefined;
  ranges: [number, number][];
  score: number;
  highlightedPath?: string;
  highlightedName?: string;
}

interface RepoInfoCache {
  data: RepoInfo[];
  timestamp: number;
}

const app = new Hono<{ Bindings: Bindings }>();

const ALL_KEY = "__ALL_INDEX__";
// Max items returned per response (prevents transport blowup); pairs with limit/offset paging to fetch everything
const MAX_RESULTS = 1000;
// Match collection cap: stop once full and mark total as approximate; a fuse for short-query memory/CPU
const SCORE_CAP = 1000;
// Parallel batch size: overlaps I/O with bounded peak memory; 100 is a measured value — lower it if 503s return
const BATCH_SIZE = 100;

function basename(p: string) {
  if (!p) return "";
  p = p.replace(/^\.\//, "").replace(/^\//, "");
  const parts = p.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : p;
}

app.use(
  // No force: prettify only when ?pretty is set; normal traffic stays compressed to save transport and serialization
  prettyJSON({
    space: 4,
  }),
);

async function loadIndexByName(c: any, name: string): Promise<IndexJson | null> {
  if (!name) return null;
  if (c.env && c.env.repo_index_kv) {
    try {
      const jsonValueOfName = await c.env.repo_index_kv.get(name);
      if (!jsonValueOfName) return null;
      return JSON.parse(jsonValueOfName) as IndexJson;
    } catch (e) {
      return null;
    }
  }
  return null;
}

const secrets = env as unknown as Bindings;

app.use(
  "*",
  basicAuth({
    username: secrets.USER,
    password: secrets.PSWD,
  }),
);

app.get("/api/get-repo-info", async (c) => {
  const CACHE_KEY = "repo-info-cache";

  // The central index pre-writes this snapshot hourly; the Worker only reads KV (no GitHub token)
  try {
    const cached = (await c.env.repo_index_kv.get(CACHE_KEY, { type: "json" })) as RepoInfoCache | null;
    if (cached && Array.isArray(cached.data)) {
      return c.json(cached.data);
    }
  } catch (e) {
    // KV read failed; fall through to the 503 below
  }

  return c.json({ error: "index not ready, run Central Repository Index workflow first" }, 503);
});

app.get("/api/search", async (c) => {
  const q = (c.req.query("q") || "").trim();
  const file = (c.req.query("file") || "all").trim();
  if (!q) return c.json({ error: "empty query" }, 400);
  // Paging: limit = page size (default 100, capped at MAX_RESULTS), offset = start index
  const limit = Math.min(Math.max(Number(c.req.query("limit")) || 100, 1), MAX_RESULTS);
  const offset = Math.max(Number(c.req.query("offset")) || 0, 0);

  if (!c.env.repo_index_kv) return c.json({ error: "repo_index_kv binding is not available" }, 500);

  try {
    const t0 = Date.now();
    let items: SearchItem[] = [];

    const parseIndexJson = (fj: IndexJson, merged: SearchItem[]) => {
      if (!fj || !Array.isArray(fj.branches)) return;
      const repoName = fj.repository || "";
      for (const br of fj.branches) {
        const branchName = br.branch_name || "";
        if (Array.isArray(br.files)) {
          for (const f of br.files) {
            const name = String(f.name || "");
            const rawPath = String(f.path || "")
              .replace(/^\.\//, "")
              .replace(/^\//, "");
            const github_url =
              repoName && branchName && rawPath
                ? `https://github.com/${repoName}/blob/${branchName}/${rawPath}`
                : undefined;
            merged.push({
              name,
              repository: repoName,
              branch: branchName,
              path: rawPath,
              size: f.size,
              github_url,
              type: "file",
            });
          }
        }
        if (Array.isArray(br.directories)) {
          for (const d of br.directories) {
            const rawPath = String(d.path || "")
              .replace(/^\.\//, "")
              .replace(/^\//, "");
            const name = basename(rawPath);
            const github_url =
              repoName && branchName && rawPath
                ? `https://github.com/${repoName}/tree/${branchName}/${rawPath}`
                : undefined;
            merged.push({
              name,
              repository: repoName,
              branch: branchName,
              path: rawPath,
              size: undefined,
              github_url,
              type: "directory",
            });
          }
        }
      }
    };

    const cacheKey = file === "all" || !file ? ALL_KEY : file;
    const isSingle = cacheKey !== ALL_KEY && !cacheKey.includes(",");
    if (isSingle && (cacheKey.includes("..") || cacheKey.includes("/"))) {
      return c.json({ error: "invalid file" }, 400);
    }
    // Batched parallel loading: concurrent within a batch, serial across batches, bounded peak memory; fresh load each time, no caching
    let loadFailCount = 0;
    async function loadOne(fname: string, into: SearchItem[]): Promise<void> {
      try {
        const fj = await loadIndexByName(c, fname);
        if (!fj) return;
        parseIndexJson(fj, into);
      } catch (e) {
        loadFailCount += 1;
        console.error(`Failed to load index ${fname}:`, e);
      }
    }
    async function loadBatched(names: string[], into: SearchItem[]): Promise<void> {
      for (const batch of chunk(names, BATCH_SIZE)) {
        await Promise.all(batch.map((fname) => loadOne(fname, into)));
      }
    }

    const merged: SearchItem[] = [];
    if (cacheKey === ALL_KEY) {
      let filesList: string[] = [];
      try {
        const kvList = await c.env.repo_index_kv.list({ limit: 1000 });
        filesList = Array.isArray(kvList.keys) ? kvList.keys.map((k: any) => k.name) : [];
      } catch (e) {
        filesList = [];
      }

      // Load repository indexes only; skip other keys such as repo-info-cache
      const names = filesList.filter((fname) => fname && fname.endsWith("-index"));
      await loadBatched(names, merged);
    } else if (cacheKey.includes(",")) {
      const fileList = cacheKey
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const seen = new Set<string>();
      const names = fileList.filter((fname) => fname && !fname.includes("..") && !fname.includes("/"));
      const temp: SearchItem[] = [];
      await loadBatched(names, temp);

      for (const it of temp) {
        const key = `${it.repository || ""}|${it.branch || ""}|${it.path || ""}|${it.type || ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(it);
      }
    } else {
      const fj = await loadIndexByName(c, cacheKey);
      if (fj) parseIndexJson(fj, merged);
    }

    items = merged;
    const tLoad = Date.now();
    const indexCount = new Set(items.map((i) => i.repository)).size;
    const itemsTotal = items.length;
    if (isSingle && items.length === 0) {
      // Distinguish "index missing" from "index empty": re-check KV when the result is empty
      const fj = await loadIndexByName(c, cacheKey);
      if (!fj) return c.json({ error: "not found" }, 404);
    }

    const mode = (c.req.query("mode") || "path").trim();

    // Phase 1: record rank keys only (index + 4 numbers, no range coordinates) and tally files/folders along the way;
    // stop at SCORE_CAP and mark total as approximate — a fuse for short-query memory/CPU
    const scored: Array<{ idx: number; key: RankKey }> = [];
    let fileCount = 0;
    let dirCount = 0;
    let truncated = false;
    for (let idx = 0; idx < items.length; idx++) {
      const it = items[idx];
      try {
        const target = mode === "name" ? it.name || "" : it.path || it.name || "";
        if (!target) continue;

        const ranges = tseSearch(target, q);
        if (!ranges) continue;

        const key = rankKeyFromRanges(ranges, Array.from(target).length);
        if (!key) continue;

        if (it.type === "directory") dirCount += 1;
        else fileCount += 1;
        scored.push({ idx, key });
        if (scored.length >= SCORE_CAP) {
          truncated = true;
          break;
        }
      } catch (se) {}
    }
    const tSearch = Date.now();

    // Phase 2: after sorting, take the offset/limit page and re-run matching only for this page's items to build highlight ranges
    scored.sort((a, b) => compareRank(a.key, b.key));
    const page = scored.slice(offset, offset + limit).slice(0, MAX_RESULTS);
    const results: SearchResult[] = page.map(({ idx, key }) => {
      const it = items[idx];
      const target = mode === "name" ? it.name || "" : it.path || it.name || "";
      const ranges = tseSearch(target, q) ?? [];
      const highlighted = buildHighlighted(target, ranges);

      const size_bytes = Number(it.size) || 0;
      const size_mb = Math.round((size_bytes / 1024 / 1024) * 100) / 100;
      const type = it.type || (size_bytes > 0 ? "file" : "directory");

      const result: SearchResult = {
        name: it.name,
        repository: it.repository,
        branch: it.branch,
        path: it.path,
        size: it.size,
        size_mb,
        type,
        github_url: it.github_url,
        ranges,
        score: key.matched,
      };
      if (mode === "name") result.highlightedName = highlighted;
      else result.highlightedPath = highlighted;
      return result;
    });

    const tookMs = Date.now() - t0;
    console.log(
      `[search] q=${q} file=${file} mode=${mode} total=${scored.length}${truncated ? "+" : ""} ` +
        `offset=${offset} limit=${limit} ` +
        `tookMs=${tookMs} loadMs=${tLoad - t0} searchMs=${tSearch - tLoad} ` +
        `indexes=${indexCount} items=${itemsTotal} fail=${loadFailCount}`,
    );
    return c.json({
      results,
      total: scored.length,
      truncated,
      fileCount,
      dirCount,
      indexCount,
      itemsTotal,
      loadFailCount,
      tookMs,
      loadMs: tLoad - t0,
      searchMs: tSearch - tLoad,
    });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

app.get("/api/repo-list", async (c) => {
  if (!c.env.repo_index_kv) return c.json({ error: "repo_index_kv binding is not available" }, 500);
  try {
    const kvList = await c.env.repo_index_kv.list();
    // Return repository indexes only; filter out internal keys such as repo-info-cache and __meta-sha-table
    const names = Array.isArray(kvList.keys)
      ? kvList.keys.map((k: any) => k.name).filter((n: string) => n.endsWith("-index"))
      : [];
    return c.json(names);
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

// Serve static assets and the root path
app.get("*", async (c) => {
  return c.env.public_assets.fetch(c.req.raw);
});

export default app;
