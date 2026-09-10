import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { basicAuth } from "hono/basic-auth";
import { prettyJSON } from "hono/pretty-json";
import { search as tseSearch } from "text-search-engine";
import { chunk } from "./batch";
import { compareRank, rankKeyFromRanges, type RankKey } from "./rank";

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
// 单次搜索最多返回条数：只截断高亮构建 + 序列化，total 仍返回全量计数
const MAX_RESULTS = 100;
// 匹配收集上限：满即停，total 标约数；给短查询的内存/CPU 上保险丝
const SCORE_CAP = 1000;
// 并行分批大小：I/O 重叠，峰值内存有界；100 为实测值，若 503 回归则降回
const BATCH_SIZE = 100;

function basename(p: string) {
  if (!p) return "";
  p = p.replace(/^\.\//, "").replace(/^\//, "");
  const parts = p.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : p;
}

app.use(
  // 不加 force：默认仅 ?pretty 时美化，正常流量保持压缩，省传输与序列化
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

async function getAllRepos(token: string): Promise<RepoInfo[]> {
  // 按需加载：octokit 只给仓库列表页用，不污染搜索路径冷启动
  const { Octokit } = await import("octokit");
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
    // 分批并行加载：批内并发、批间串行，峰值内存有界；每次全新加载，无缓存
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

      // 只加载仓库索引，跳过 repo-info-cache 等其它 key
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
      // 区分“索引不存在”与“索引为空”：空结果时复查一次 KV
      const fj = await loadIndexByName(c, cacheKey);
      if (!fj) return c.json({ error: "not found" }, 404);
    }

    const mode = (c.req.query("mode") || "path").trim();

    // 第一阶段：全量只记排名键（下标+4 个数，不存 ranges 坐标），顺手计文件/文件夹数；
    // 满 SCORE_CAP 即停，total 标约数，给短查询的内存/CPU 上保险丝
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

    // 第二阶段：排序截断后，只给入选条目重跑匹配拿 ranges 拼高亮
    scored.sort((a, b) => compareRank(a.key, b.key));
    const results: SearchResult[] = scored.slice(0, MAX_RESULTS).map(({ idx, key }) => {
      const it = items[idx];
      const target = mode === "name" ? it.name || "" : it.path || it.name || "";
      const ranges = [...(tseSearch(target, q) ?? [])].sort((a, b) => a[0] - b[0]);
      const chars = Array.from(target);

      let highlighted = "";
      let pos = 0;
      for (const [sRaw, eRaw] of ranges) {
        const s = Math.max(sRaw, pos);
        if (eRaw < pos) continue;
        highlighted +=
          chars.slice(pos, s).join("") + "<mark>" + chars.slice(s, eRaw + 1).join("") + "</mark>";
        pos = eRaw + 1;
      }
      highlighted += chars.slice(pos).join("");

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
    // 只返回仓库索引，过滤 repo-info-cache、__meta-sha-table 等内部 key
    const names = Array.isArray(kvList.keys)
      ? kvList.keys.map((k: any) => k.name).filter((n: string) => n.endsWith("-index"))
      : [];
    return c.json(names);
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

// 处理静态资源和根路径
app.get("*", async (c) => {
  return c.env.public_assets.fetch(c.req.raw);
});

export default app;
