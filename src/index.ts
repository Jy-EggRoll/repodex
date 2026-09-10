import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { basicAuth } from "hono/basic-auth";
import { prettyJSON } from "hono/pretty-json";
import { Octokit } from "octokit";
import { search as tseSearch } from "text-search-engine";

type Bindings = {
  public_assets: Fetcher;
  repo_index_kv: KVNamespace;
  USER: string;
  PSWD: string;
  REPO_INFO_TOKEN: string;
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
// 解析后的 items 缓存 TTL（秒）：连击输入时跳过 KV 读 + parse + merge
const ITEMS_CACHE_TTL = 120;
// 单次搜索最多返回条数：只截断高亮构建 + 序列化，total 仍返回全量计数
const MAX_RESULTS = 300;

async function getCachedItems(cacheKey: string, loader: () => Promise<SearchItem[]>): Promise<SearchItem[]> {
  const url = `https://repodex-items.local/${encodeURIComponent(cacheKey)}`;
  const cache = await caches.open("repodex-items");
  try {
    const hit = await cache.match(url);
    if (hit) return (await hit.json()) as SearchItem[];
  } catch {
    // miss：继续走 KV 加载
  }
  const items = await loader();
  try {
    await cache.put(
      url,
      new Response(JSON.stringify(items), {
        headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${ITEMS_CACHE_TTL}` },
      }),
    );
  } catch {
    // 缓存写失败不影响返回
  }
  return items;
}

function basename(p: string) {
  if (!p) return "";
  p = p.replace(/^\.\//, "").replace(/^\//, "");
  const parts = p.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : p;
}

app.use(
  prettyJSON({
    space: 4,
    force: true,
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

async function getAllRepos(token: string): Promise<RepoInfo[]> {
  const octokit = new Octokit({
    auth: token,
    request: { timeout: 10000 },
  });
  const repos: RepoInfo[] = [];
  let page = 1;
  const perPage = 100;
  while (true) {
    const response = await octokit.request("GET /user/repos", { type: "all", per_page: perPage, page });
    if (response.data.length === 0) break;
    for (const item of response.data) {
      const size_kb = Number(item.size) || 0;
      const size_mb = Math.round((size_kb / 1024) * 100) / 100;
      let risk: "safe" | "warn" | "danger" = "safe";
      if (size_mb < 800) {
        risk = "safe";
      } else if (size_mb <= 900) {
        risk = "warn";
      } else {
        risk = "danger";
      }
      repos.push({
        name: item.name,
        size: size_kb,
        size_mb,
        risk,
        description: item.description,
        html_url: item.html_url,
      });
    }
    page++;
  }
  return repos;
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
  const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  // Try to get from cache first
  try {
    const cached = (await c.env.repo_index_kv.get(CACHE_KEY, { type: "json" })) as RepoInfoCache | null;
    if (cached && Array.isArray(cached.data) && Date.now() - cached.timestamp < CACHE_TTL) {
      return c.json(cached.data);
    }
  } catch (e) {
    // Cache miss or error, continue to fetch from GitHub
  }

  // Fetch from GitHub API
  const filterRepos = await getAllRepos(
    (c.env as unknown as Bindings).REPO_INFO_TOKEN ?? secrets.REPO_INFO_TOKEN,
  );

  // Save to cache
  try {
    await c.env.repo_index_kv.put(
      CACHE_KEY,
      JSON.stringify({
        data: filterRepos,
        timestamp: Date.now(),
      } as RepoInfoCache),
      { expirationTtl: 600 },
    ); // 10 minutes expiration as backup
  } catch (e) {
    // Cache write failed, but we can still return the data
  }

  return c.json(filterRepos);
});

app.get("/api/search", async (c) => {
  const q = (c.req.query("q") || "").trim();
  const file = (c.req.query("file") || "all").trim();
  if (!q) return c.json({ error: "empty query" }, 400);

  const rawReq = (c.req as any).raw as Request | undefined;
  const base = rawReq?.url ?? c.req.url;

  if (!c.env.repo_index_kv) return c.json({ error: "repo_index_kv binding is not available" }, 500);

  try {
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
    items = await getCachedItems(cacheKey, async () => {
      const merged: SearchItem[] = [];
      if (cacheKey === ALL_KEY) {
        let filesList: string[] = [];
        try {
          const kvList = await c.env.repo_index_kv.list({ limit: 1000 });
          filesList = Array.isArray(kvList.keys) ? kvList.keys.map((k: any) => k.name) : [];
        } catch (e) {
          filesList = [];
        }

        for (const fname of filesList) {
          try {
            // 只加载仓库索引，跳过 repo-info-cache 等其它 key
            if (!fname || !fname.endsWith("-index")) continue;
            const fj = await loadIndexByName(c, fname);
            if (!fj) continue;
            parseIndexJson(fj, merged);
          } catch (e) {
            console.error(`Failed to load index ${fname}:`, e);
          }
        }
      } else if (cacheKey.includes(",")) {
        const fileList = cacheKey
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const seen = new Set<string>();
        for (const fname of fileList) {
          try {
            if (!fname || fname.includes("..") || fname.includes("/")) continue;

            const fj = await loadIndexByName(c, fname);
            if (!fj) continue;
            const temp: SearchItem[] = [];
            parseIndexJson(fj, temp);

            for (const it of temp) {
              const key = `${it.repository || ""}|${it.branch || ""}|${it.path || ""}|${it.type || ""}`;
              if (seen.has(key)) continue;
              seen.add(key);
              merged.push(it);
            }
          } catch (e) {
            console.error(`Failed to load index ${fname}:`, e);
          }
        }
      } else {
        const fj = await loadIndexByName(c, cacheKey);
        if (!fj) return merged;
        parseIndexJson(fj, merged);
      }

      return merged;
    });
    if (isSingle && items.length === 0) {
      // 区分“索引不存在”与“索引为空”：空结果时复查一次 KV
      const fj = await loadIndexByName(c, cacheKey);
      if (!fj) return c.json({ error: "not found" }, 404);
    }

    const mode = (c.req.query("mode") || "path").trim();

    const results: SearchResult[] = [];
    for (const it of items) {
      try {
        const target = mode === "name" ? it.name || "" : it.path || it.name || "";
        if (!target) continue;

        const ranges = tseSearch(target, q);
        if (!ranges) continue;

        let score = 0;
        for (const r of ranges) score += r[1] - r[0] + 1;

        const chars = Array.from(target);
        const markStarts = new Set<number>();
        const markEnds = new Set<number>();
        for (const r of ranges) {
          markStarts.add(r[0]);
          markEnds.add(r[1]);
        }

        let highlighted = "";
        for (let i = 0; i < chars.length; i++) {
          if (markStarts.has(i)) highlighted += "<mark>";
          highlighted += chars[i];
          if (markEnds.has(i)) highlighted += "</mark>";
        }

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
          score,
        };
        if (mode === "name") result.highlightedName = highlighted;
        else result.highlightedPath = highlighted;

        results.push(result);
      } catch (se) {}
    }

    results.sort((a, b) => b.score - a.score);
    return c.json({ results: results.slice(0, MAX_RESULTS), total: results.length });
  } catch (err) {
    return c.json({ error: "failed to search", details: String(err) }, 500);
  }
});

app.get("/api/repo-list", async (c) => {
  if (!c.env.repo_index_kv) return c.json({ error: "repo_index_kv binding is not available" }, 500);
  try {
    const kvList = await c.env.repo_index_kv.list();
    // 只返回仓库索引，过滤 repo-info-cache、__meta-sha-table 等内部 key
    const names = Array.isArray(kvList.keys)
      ? kvList.keys.map((k: any) => k.name).filter((n: string) => n.endsWith("-index"))
      : [];
    return c.json(names);
  } catch (e) {
    return c.json({ error: "failed to list keys from repo_index_kv", details: String(e) }, 500);
  }
});

// 处理静态资源和根路径
app.get("*", async (c) => {
  return c.env.public_assets.fetch(c.req.raw);
});

export default app;
