import { env } from "cloudflare:workers";
import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth'
import { prettyJSON } from 'hono/pretty-json'
import { Octokit } from "octokit";
import { search as tseSearch } from 'text-search-engine';

type Bindings = {
  public_assets: Fetcher;
  repo_index_kv: KVNamespace;
}

const app = new Hono<{ Bindings: Bindings }>()

const indexCache = new Map<string, Array<{ name: string, repository?: string, branch?: string, path?: string, size?: number, github_url?: string, type?: 'file' | 'directory' }>>();
const ALL_KEY = '__ALL_INDEX__';

function basename(p: string) {
  if (!p) return '';
  p = p.replace(/^\.\//, '').replace(/^\//, '');
  const parts = p.split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : p;
}

app.use(prettyJSON({
  space: 4,
  force: true
}))

async function loadIndexByName(c: any, base: string, name: string) {
  if (!name) return null;
  if (c.env && c.env.repo_index_kv) {
    try {
      const jsonValueOfName = await c.env.repo_index_kv.get(name);
      if (!jsonValueOfName) return null;
      return JSON.parse(jsonValueOfName);
    } catch (e) {
      return null;
    }
  }
  return null;
}

async function getAllRepos(token: string): Promise<any[]> {
  const octokit = new Octokit({
    auth: token,
    request: { timeout: 10000 }
  });
  const repos: any[] = [];
  let page = 1;
  const perPage = 100;
  while (true) {
    const response = await octokit.request("GET /user/repos", { type: "all", per_page: perPage, page });
    if (response.data.length === 0) break;
    repos.push(...response.data);
    page++;
  }
  return repos;
}

app.use(
  '*',
  basicAuth({
    username: env.USER,
    password: env.PSWD,
  })
)

app.get('/api/get-repo-info', async (c) => {
  const rawReposData = await getAllRepos(env.REPO_INFO_TOKEN);
  const filterRepos = rawReposData.map(item => {
    const size_kb = Number(item.size) || 0;
    const size_mb = Math.round((size_kb / 1024) * 100) / 100;
    let risk: 'safe' | 'warn' | 'danger' = 'safe';
    if (size_mb < 800) {
      risk = 'safe';
    } else if (size_mb <= 900) {
      risk = 'warn';
    } else {
      risk = 'danger';
    }
    return {
      name: item.name,
      size: size_kb,
      size_mb,
      risk,
      description: item.description,
      html_url: item.html_url
    };
  });
  return c.json(filterRepos)
});

app.get('/api/search', async (c) => {
  const q = (c.req.query('q') || '').trim();
  const file = (c.req.query('file') || 'all').trim();
  if (!q) return c.json({ error: 'empty query' }, 400);

  const rawReq = (c.req as any).raw as Request | undefined;
  const base = rawReq?.url ?? c.req.url;

  if (!c.env.repo_index_kv) return c.json({ error: 'repo_index_kv binding is not available' }, 500);

  try {

    let items: Array<{ name: string; repository?: string; branch?: string; path?: string; size?: number; github_url?: string; type?: 'file' | 'directory' }> = [];


    const parseIndexJson = (fj: any, merged: any[]) => {
      if (!fj || !Array.isArray(fj.branches)) return;
      const repoName = fj.repository || '';
      for (const br of fj.branches) {
        const branchName = br.branch_name || '';
        if (Array.isArray(br.files)) {
          for (const f of br.files) {
            const name = String(f.name || '');
            const rawPath = String(f.path || '').replace(/^\.\//, '').replace(/^\//, '');
            const github_url = repoName && branchName && rawPath ? `https://github.com/${repoName}/blob/${branchName}/${rawPath}` : undefined;
            merged.push({ name, repository: repoName, branch: branchName, path: rawPath, size: f.size, github_url, type: 'file' });
          }
        }
        if (Array.isArray(br.directories)) {
          for (const d of br.directories) {
            const rawPath = String(d.path || '').replace(/^\.\//, '').replace(/^\//, '');
            const name = basename(rawPath);
            const github_url = repoName && branchName && rawPath ? `https://github.com/${repoName}/tree/${branchName}/${rawPath}` : undefined;
            merged.push({ name, repository: repoName, branch: branchName, path: rawPath, size: undefined, github_url, type: 'directory' });
          }
        }
      }
    };




    const cacheKey = (file === 'all' || !file) ? ALL_KEY : file;
    const cached = indexCache.get(cacheKey);
    if (cached && cached.length > 0) {
      items = cached;
    } else {
      const merged: any[] = [];
      if (cacheKey === ALL_KEY) {

        let filesList: string[] = [];
        try {
          const kvList = await c.env.repo_index_kv.list({ limit: 1000 });
          filesList = Array.isArray(kvList.keys) ? kvList.keys.map((k: any) => k.name) : [];
        } catch (e) { filesList = []; }

        for (const fname of filesList) {
          try {
            if (!fname) continue;
            const fj = await loadIndexByName(c, base, fname);
            if (!fj) continue;
            parseIndexJson(fj, merged);
          } catch (e) { }
        }
      } else if (cacheKey.includes(',')) {

        const fileList = cacheKey.split(',').map(s => s.trim()).filter(Boolean);
        const seen = new Set<string>();
        for (const fname of fileList) {
          try {
            if (!fname || fname.includes('..') || fname.includes('/')) continue;


            let per = indexCache.get(fname);
            if (!per) {
              const fj = await loadIndexByName(c, base, fname);
              if (!fj) continue;
              const temp: any[] = [];
              parseIndexJson(fj, temp);
              per = temp;
              indexCache.set(fname, per);
            }

            for (const it of per) {
              const key = `${it.repository || ''}|${it.branch || ''}|${it.path || ''}|${it.type || ''}`;
              if (seen.has(key)) continue;
              seen.add(key);
              merged.push(it);
            }
          } catch (e) { }
        }
      } else {

        if (cacheKey.includes('..') || cacheKey.includes('/')) return c.json({ error: 'invalid file' }, 400);
        const fj = await loadIndexByName(c, base, cacheKey);
        if (!fj) return c.json({ error: 'not found' }, 404);
        parseIndexJson(fj, merged);

        indexCache.set(cacheKey, merged);
      }


      indexCache.set(cacheKey, merged);
      items = merged;
    }

    const mode = (c.req.query('mode') || 'path').trim();

    const results: Array<any> = [];
    for (const it of items) {
      try {

        const target = (mode === 'name') ? (it.name || '') : (it.path || it.name || '');
        if (!target) continue;

        const ranges = tseSearch(target, q);
        if (!ranges) continue;

        let score = 0;
        for (const r of ranges) score += (r[1] - r[0] + 1);


        const chars = Array.from(target);
        const markStarts = new Set<number>();
        const markEnds = new Set<number>();
        for (const r of ranges) { markStarts.add(r[0]); markEnds.add(r[1]); }

        let highlighted = '';
        for (let i = 0; i < chars.length; i++) {
          if (markStarts.has(i)) highlighted += '<mark class="bg-yellow-200">';
          highlighted += chars[i];
          if (markEnds.has(i)) highlighted += '</mark>';
        }

        const size_bytes = Number(it.size) || 0;
        const size_mb = Math.round((size_bytes / 1024 / 1024) * 100) / 100;
        const type = (it as any).type || (size_bytes > 0 ? 'file' : 'directory');


        const result: any = {
          name: it.name,
          repository: it.repository,
          branch: it.branch,
          path: it.path,
          size: it.size,
          size_mb,
          type,
          github_url: it.github_url,
          ranges,
          score
        };
        if (mode === 'name') result.highlightedName = highlighted;
        else result.highlightedPath = highlighted;

        results.push(result);
      } catch (se) { }
    }

    results.sort((a, b) => b.score - a.score);
    return c.json(results);
  } catch (err) {
    return c.json({ error: 'failed to search', details: String(err) }, 500);
  }
});

app.get('/api/repo-list', async (c) => {
  if (!c.env.repo_index_kv) return c.json({ error: 'repo_index_kv binding is not available' }, 500);
  try {
    const kvList = await c.env.repo_index_kv.list();
    const names = Array.isArray(kvList.keys) ? kvList.keys.map((k: any) => k.name) : [];
    return c.json(names);
  } catch (e) {
    return c.json({ error: 'failed to list keys from repo_index_kv', details: String(e) }, 500);
  }
});

// 处理静态资源和根路径
app.get('*', async (c) => {
  return c.env.public_assets.fetch(c.req.raw)
})

export default app
