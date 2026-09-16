// Central index generator: discover repos -> compare SHAs -> build incremental indexes -> push to KV -> prune stale keys.
//
// The index lives in chunked v3 keys: `<owner>/<repo>@<i>` chunks plus a `__meta-plan` manifest the
// Worker reads. Chunks are never mixed across repositories, which keeps stale-plan reads safe. Keys
// left over from retired formats (`<short>-index@<i>` chunks and bare `<short>-index` envelopes) are
// deleted by the prune pass of a full run.
//
// Plan repo entries also record each repository's last push time (epoch ms), which readers turn into
// a bounded recency boost when ranking. The data comes from the repo list fetched below, so it costs
// no extra API calls.
//
// Zero dependencies (Node 18+ built-in fetch). Required environment variables:
//   REPOS_PAT        GitHub token that can read every indexed repository. Discovery covers personal
//                    repos, organization repos, and repos where you are a collaborator. A classic PAT
//                    with `repo` scope reaches all of them; a fine-grained token (Contents + Metadata
//                    read-only) reaches only personal repos plus organizations that approved it
//   CF_API_TOKEN     Cloudflare API Token (needs Workers KV Storage write permission)
//   CF_ACCOUNT_ID    Cloudflare Account ID
//   CF_NAMESPACE_ID  Cloudflare KV Namespace ID
//   REPOS_ONLY       Optional, comma-separated owner/repo; process only these repos (manual re-runs)
//   DRY_RUN          Optional, set to 1 to report only without writing KV

const GH_API = "https://api.github.com";
const CF_API = "https://api.cloudflare.com/client/v4";
const SHA_TABLE_KEY = "__meta-sha-table";
const REPO_INFO_CACHE_KEY = "repo-info-cache";
const PLAN_KEY = "__meta-plan";
// Sentinel inside the SHA table: a mismatch forces one full rebuild so missing chunks get backfilled,
// and only a successful full run may write it (single-repo runs must not, or the next full run would
// happily skip repositories that never got chunked)
const FORMAT_KEY = "__format";
const FORMAT_VERSION = 3;
const CHUNK_ITEMS = 20000;
const CHUNK_KEY_RE = /@\d+$/;

// Terminal colors go to stderr only (console logs); stdout is reserved for clean markdown in the Summary
const paint = (code) => (s) => (process.env.NO_COLOR === "1" ? s : `\x1b[${code}m${s}\x1b[0m`);
const green = paint(32);
const gray = paint(90);
const yellow = paint(33);
const red = paint(31);
const cyan = paint(36);

function required(name) {
  const value = (process.env[name] ?? "").trim();
  if (!value) {
    console.error(`Missing required env: ${name}`);
    process.exit(1);
  }
  return value;
}

async function ghRequest(path, token, what = path) {
  // GitHub API calls with automatic pagination: concatenate arrays, return objects as-is.
  let result = null;
  let page = 1;
  for (;;) {
    const sep = path.includes("?") ? "&" : "?";
    const res = await fetch(`${GH_API}${path}${sep}per_page=100&page=${page}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!res.ok) {
      console.error(`GitHub API failed: ${what} -> HTTP ${res.status}`);
      process.exit(1);
    }
    const data = await res.json();
    if (!Array.isArray(data)) return data;
    result = (result ?? []).concat(data);
    if (data.length < 100) return result;
    page += 1;
  }
}

async function cfKvGet(account, namespace, token, key) {
  const res = await fetch(`${CF_API}/accounts/${account}/storage/kv/namespaces/${namespace}/values/${key}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    console.error(`KV GET failed -> HTTP ${res.status}`);
    process.exit(1);
  }
  return res.json();
}

async function cfKvPut(account, namespace, token, key, value, dryRun) {
  if (dryRun) return;
  const res = await fetch(`${CF_API}/accounts/${account}/storage/kv/namespaces/${namespace}/values/${key}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(value),
  });
  if (!res.ok) {
    console.error(`KV PUT failed -> HTTP ${res.status}`);
    process.exit(1);
  }
  const result = await res.json();
  if (result.success === false) {
    console.error("KV PUT returned success=false");
    process.exit(1);
  }
}

async function cfKvDelete(account, namespace, token, key, dryRun) {
  if (dryRun) return;
  const res = await fetch(`${CF_API}/accounts/${account}/storage/kv/namespaces/${namespace}/values/${key}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    console.error(`KV DELETE failed -> HTTP ${res.status}`);
    process.exit(1);
  }
}

async function cfKvList(account, namespace, token) {
  const res = await fetch(
    `${CF_API}/accounts/${account}/storage/kv/namespaces/${namespace}/keys?limit=1000`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    console.error(`KV LIST failed -> HTTP ${res.status}`);
    process.exit(1);
  }
  const result = await res.json();
  if (result.success === false) {
    console.error("KV LIST returned success=false");
    process.exit(1);
  }
  return (result.result ?? []).map((k) => k.name);
}

/** repos-blocklist.txt: one owner/repo per line; lines starting with # and blank lines are ignored. */
export function parseBlocklist(text) {
  return new Set(
    text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#")),
  );
}

/** No changes when the SHA tables match, so the repo can be skipped. */
export function needsUpdate(stored, current) {
  const a = stored ?? {};
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(current);
  if (aKeys.length !== bKeys.length) return true;
  return bKeys.some((k) => a[k] !== current[k]);
}

/** Skip only when SHAs match, the repo already has index data, and the stored format is current (a format bump forces one full rebuild). */
export function shouldSkip(stored, current, keyExists, formatOk) {
  return Boolean(formatOk) && !needsUpdate(stored, current) && keyExists;
}

/** Tree entries to one branch's index items: files first, then directories, paths without a "./" prefix. */
export function buildBranchItems(branchName, entries) {
  const items = [];
  const directories = [];
  for (const entry of entries) {
    const path = entry.path ?? "";
    if (!path) continue;
    if (entry.type === "blob") items.push({ type: "file", path, size: entry.size ?? 0 });
    else if (entry.type === "tree") directories.push({ type: "directory", path });
  }
  return { branch: branchName, items: [...items, ...directories] };
}

/** Paths are stored without a leading "./" or "/" (readers re-derive names from the path). */
function stripDotSlash(p) {
  return String(p ?? "")
    .replace(/^\.\//, "")
    .replace(/^\//, "");
}

/** Compact chunk payload: [[t, path, size], ...] with t=0 file / t=1 directory; directories omit size. */
export function encodeChunk(items) {
  return items.map((item) =>
    item.type === "directory" ? [1, stripDotSlash(item.path)] : [0, stripDotSlash(item.path), item.size ?? 0],
  );
}

/** Split one repository's branches into chunks; a branch never spans chunks. */
export function buildChunkWrites(repo, branches) {
  const chunks = [];
  let index = 0;
  let total = 0;
  for (const branch of branches ?? []) {
    const items = branch.items ?? [];
    for (let i = 0; i < items.length; i += CHUNK_ITEMS) {
      const slice = items.slice(i, i + CHUNK_ITEMS);
      chunks.push({
        key: `${repo.fullName}@${index}`,
        branch: branch.branch,
        n: slice.length,
        value: encodeChunk(slice),
      });
      index += 1;
      total += slice.length;
    }
  }
  return { chunks, repo: { r: repo.fullName, n: total } };
}

/**
 * Keys to delete after a full run: chunks the new plan does not reference (any `@<i>` key, which
 * covers stale chunks of current and retired formats), plus every bare `-index` envelope (the
 * retired legacy format; nothing reads or writes it anymore). __meta-* is never touched.
 * Single-repo runs must not use this (it would prune every other repo).
 */
export function computePruneList(existingKeys, planChunks) {
  const keepChunks = new Set((planChunks ?? []).map((c) => c.k));
  const out = [];
  for (const key of existingKeys ?? []) {
    if (key.startsWith("__meta-")) continue;
    if (CHUNK_KEY_RE.test(key)) {
      if (!keepChunks.has(key)) out.push(key);
    } else if (key.endsWith("-index")) {
      out.push(key);
    }
  }
  return out;
}

/** Attach each repo's last push time (epoch ms) to its plan entry; readers rank recently pushed repos higher. */
export function attachPushedAt(list, pushedAtByFull) {
  return (list ?? []).map((rp) => ({ ...rp, t: pushedAtByFull.get(rp.r) ?? rp.t }));
}

/** Repos to RepoInfo: same shape as the Worker's old getAllRepos output; no filtering (archived included). */
export function buildRepoInfo(repos) {
  const infos = [];
  for (const repo of repos ?? []) {
    if (!repo || typeof repo.name !== "string" || !repo.name) continue;
    const sizeKb = Number(repo.size) || 0;
    const sizeMb = Math.round((sizeKb / 1024) * 100) / 100;
    infos.push({
      name: repo.name,
      size: sizeKb,
      size_mb: sizeMb,
      risk: sizeMb < 800 ? "safe" : sizeMb <= 900 ? "warn" : "danger",
      description: repo.description ?? null,
      html_url: repo.html_url ?? "",
    });
  }
  return infos;
}

async function main() {
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

  const ghToken = required("REPOS_PAT");
  const cfToken = required("CF_API_TOKEN");
  const cfAccount = required("CF_ACCOUNT_ID");
  const cfNamespace = required("CF_NAMESPACE_ID");
  const only = new Set(
    (process.env.REPOS_ONLY ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const dryRun = process.env.DRY_RUN === "1";

  let blocklist = new Set();
  try {
    blocklist = parseBlocklist(await readFile(join(repoRoot, "repos-blocklist.txt"), "utf-8"));
  } catch {
    // Missing file = empty blocklist
  }

  const storedTable = (await cfKvGet(cfAccount, cfNamespace, cfToken, SHA_TABLE_KEY)) ?? {};
  const shaTable = typeof storedTable === "object" && storedTable !== null ? storedTable : {};
  const formatOk = shaTable[FORMAT_KEY] === FORMAT_VERSION;
  const rawPlan = await cfKvGet(cfAccount, cfNamespace, cfToken, PLAN_KEY);
  const prevPlan =
    rawPlan &&
    typeof rawPlan === "object" &&
    rawPlan.v === FORMAT_VERSION &&
    Array.isArray(rawPlan.chunks) &&
    Array.isArray(rawPlan.repos)
      ? rawPlan
      : null;
  // Repos the plan records as empty (n=0): they have no chunk to key off, so the plan itself marks them indexed
  const plannedEmpty = new Set(
    (prevPlan?.repos ?? []).filter((rp) => rp && rp.n === 0 && rp.r).map((rp) => rp.r),
  );

  // Log split: the tally goes to stderr (colored console), the report to stdout (clean markdown for the Summary); output never contains repo names
  const say = (s) => console.error(s);
  const startedAt = Date.now();
  const counts = { total: 0, updated: 0, skipped: 0, warned: 0, pruned: 0, chunks: 0 };
  const discoveredKeys = new Set();
  const existingKeys = new Set(await cfKvList(cfAccount, cfNamespace, cfToken));
  const newChunks = [];
  const newRepos = [];
  const rebuilt = new Set();

  // All three affiliations: personal repos, organization repos, and repos where you are a collaborator
  const repos = await ghRequest(
    "/user/repos?affiliation=owner,collaborator,organization_member&sort=full_name",
    ghToken,
  );
  // Last-push table for the plan (free: already in the repo list response); missing repos keep their previous value
  const pushedAt = new Map();
  for (const repo of repos) {
    const t = Date.parse(repo.pushed_at ?? "");
    if (repo.full_name && Number.isFinite(t)) pushedAt.set(repo.full_name, t);
  }
  for (const repo of repos) {
    const fullName = repo.full_name ?? "";
    if (!fullName || repo.archived || repo.disabled) continue;
    if (only.size > 0 && !only.has(fullName)) continue;
    counts.total += 1;
    if (blocklist.has(fullName)) {
      counts.skipped += 1;
      continue;
    }
    discoveredKeys.add(fullName);

    const branchList = await ghRequest(`/repos/${fullName}/branches`, ghToken, "branches");
    const current = Object.fromEntries(
      branchList.filter((b) => b.name && b.commit).map((b) => [b.name, b.commit.sha]),
    );
    if (Object.keys(current).length === 0) {
      counts.skipped += 1;
      continue;
    }
    // A repo counts as indexed when its first chunk exists, or the plan records it as empty (n=0)
    const keyExists = existingKeys.has(`${fullName}@0`) || plannedEmpty.has(fullName);
    if (shouldSkip(shaTable[fullName], current, keyExists, formatOk)) {
      counts.skipped += 1;
      continue;
    }

    const branches = [];
    let treeFailed = false;
    for (const [branchName, headSha] of Object.entries(current).sort()) {
      const tree = await ghRequest(
        `/repos/${fullName}/git/trees/${headSha}?recursive=1`,
        ghToken,
        "git tree",
      );
      if (typeof tree !== "object" || tree === null || Array.isArray(tree) || tree.truncated) {
        treeFailed = true;
        break;
      }
      branches.push(buildBranchItems(branchName, tree.tree ?? []));
    }
    if (treeFailed) {
      counts.warned += 1;
      continue;
    }
    // Chunks land before the plan is rewritten: a reader must never follow a plan that points at a
    // chunk that has not landed yet
    const writes = buildChunkWrites({ fullName }, branches);
    for (const c of writes.chunks) {
      await cfKvPut(cfAccount, cfNamespace, cfToken, c.key, c.value, dryRun);
    }
    for (const c of writes.chunks) {
      newChunks.push({ k: c.key, r: fullName, b: c.branch, n: c.n });
    }
    newRepos.push(writes.repo);
    rebuilt.add(fullName);
    counts.chunks += writes.chunks.length;
    if (!dryRun) shaTable[fullName] = current;
    counts.updated += 1;
  }

  // Plan assembly: fresh entries for rebuilt repos; carried-over entries for the rest (full runs carry
  // only repos that are still discovered, single runs keep everything they did not touch)
  const carriedRepos = [];
  if (prevPlan) {
    for (const rp of prevPlan.repos) {
      if (rebuilt.has(rp.r)) continue;
      if (only.size === 0 && !discoveredKeys.has(rp.r)) continue;
      carriedRepos.push(rp);
    }
  }
  const carriedNames = new Set(carriedRepos.map((rp) => rp.r));
  const carriedChunks = (prevPlan?.chunks ?? []).filter((c) => carriedNames.has(c.r));
  const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const chunkNumber = (k) => Number(k.slice(k.lastIndexOf("@") + 1));
  const plan = {
    v: FORMAT_VERSION,
    chunks: [...newChunks, ...carriedChunks].sort(
      (a, b) => byText(a.r, b.r) || byText(a.b, b.b) || chunkNumber(a.k) - chunkNumber(b.k),
    ),
    repos: attachPushedAt([...newRepos, ...carriedRepos], pushedAt).sort((a, b) => byText(a.r, b.r)),
    ts: Date.now(),
  };
  await cfKvPut(cfAccount, cfNamespace, cfToken, PLAN_KEY, plan, dryRun);

  // Prune runs only on full syncs (single-repo runs must never touch other repos' keys): the plan is
  // written first, so a plan never references a chunk that this same run is about to delete
  if (only.size === 0) {
    const pruneList = computePruneList(existingKeys, plan.chunks);
    for (const key of pruneList) {
      await cfKvDelete(cfAccount, cfNamespace, cfToken, key, dryRun);
      counts.pruned += 1;
    }
  } else {
    // Single-repo runs only drop this repo's own superseded chunks: orphans from an earlier, longer
    // run (retired-format leftovers are cleaned up by the next full run)
    const freshKeys = new Set(newChunks.map((c) => c.k));
    const rebuiltRepos = [...new Set(newRepos.map((rp) => rp.r))];
    for (const key of existingKeys) {
      for (const r of rebuiltRepos) {
        if (key.startsWith(`${r}@`) && !freshKeys.has(key)) {
          await cfKvDelete(cfAccount, cfNamespace, cfToken, key, dryRun);
          counts.pruned += 1;
          break;
        }
      }
    }
  }

  // Only a successful full run may mark the stored format: a single-repo run that set it would make
  // the next full run skip repositories that never got chunked
  if (only.size === 0 && !dryRun) shaTable[FORMAT_KEY] = FORMAT_VERSION;
  if (!dryRun) await cfKvPut(cfAccount, cfNamespace, cfToken, SHA_TABLE_KEY, shaTable, dryRun);

  // Repo list snapshot: overwritten on full sync, unfiltered (matches the old Worker direct-query behavior); skipped on manual single-repo runs to avoid accidental deletion
  if (only.size === 0) {
    const repoInfos = buildRepoInfo(repos);
    await cfKvPut(
      cfAccount,
      cfNamespace,
      cfToken,
      REPO_INFO_CACHE_KEY,
      { data: repoInfos, timestamp: Date.now() },
      dryRun,
    );
    say(green(`✓ Repo list updated (${repoInfos.length} repos)`));
  } else {
    say(gray("-> Single-repo run: skipping repo list update"));
  }

  const seconds = Math.round((Date.now() - startedAt) / 1000);
  const tally = `${counts.updated} updated · ${counts.chunks} chunks · ${counts.skipped} skipped · ${counts.warned} warned · ${counts.pruned} pruned · ${seconds}s`;
  say(
    cyan(`${counts.total} repos: `) +
      green(`${counts.updated} updated`) +
      gray(` · ${counts.chunks} chunk writes`) +
      gray(` · ${counts.skipped} skipped`) +
      yellow(` · ${counts.warned} warned · ${counts.pruned} pruned`) +
      cyan(` · ${seconds}s`),
  );
  console.log("## Index Sync Summary\n");
  console.log(`${counts.total} repos: ${tally}\n`);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
