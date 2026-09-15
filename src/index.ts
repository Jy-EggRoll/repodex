import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { basicAuth } from "hono/basic-auth";
import { prettyJSON } from "hono/pretty-json";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { SearchEngine } from "./search-do";

type Bindings = {
  public_assets: Fetcher;
  repo_index_kv: KVNamespace;
  SEARCH_ENGINE: DurableObjectNamespace<SearchEngine>;
  USER: string;
  PSWD: string;
};

interface RepoInfo {
  name: string;
  size: number;
  size_mb: number;
  risk: "safe" | "warn" | "danger";
  description: string | null;
  html_url: string;
}

interface RepoInfoCache {
  data: RepoInfo[];
  timestamp: number;
}

const app = new Hono<{ Bindings: Bindings }>();

app.use(
  // No force: prettify only when ?pretty is set; normal traffic stays compressed to save transport and serialization
  prettyJSON({
    space: 4,
  }),
);

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
  if (!q) return c.json({ error: "empty query" }, 400);
  if (!c.env.repo_index_kv) return c.json({ error: "repo_index_kv binding is not available" }, 500);

  try {
    const stub = c.env.SEARCH_ENGINE.get(c.env.SEARCH_ENGINE.idFromName("global"));
    // Thin relay: the Durable Object loads, scans, and serializes the whole response under its own
    // CPU budget; this route only forwards the bytes (re-serializing here would burn the 10ms limit).
    const outcome = await stub.search({
      q,
      file: c.req.query("file") ?? "",
      mode: c.req.query("mode") ?? "",
      limit: c.req.query("limit") ?? "",
      offset: c.req.query("offset") ?? "",
    });
    return c.body(outcome.json, outcome.status as ContentfulStatusCode, {
      "Content-Type": "application/json",
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
export { SearchEngine } from "./search-do";
