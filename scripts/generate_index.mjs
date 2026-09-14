// Central index generator: discover repos -> compare SHAs -> build incremental indexes -> push to KV -> prune stale keys.
//
// Zero dependencies (Node 18+ built-in fetch). Required environment variables:
//   REPOS_PAT        GitHub fine-grained PAT (Contents: read-only + Metadata: read-only, all repositories)
//   CF_API_TOKEN     Cloudflare API Token (needs Workers KV Storage write permission)
//   CF_ACCOUNT_ID    Cloudflare Account ID
//   CF_NAMESPACE_ID  Cloudflare KV Namespace ID
//   REPOS_ONLY       Optional, comma-separated owner/repo; process only these repos (manual re-runs)
//   DRY_RUN          Optional, set to 1 to report only without writing KV

const GH_API = "https://api.github.com";
const CF_API = "https://api.cloudflare.com/client/v4";
const SHA_TABLE_KEY = "__meta-sha-table";
const REPO_INFO_CACHE_KEY = "repo-info-cache";

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

/** Skip only when SHAs match and the index key actually exists (prevents silently missing indexes). */
export function shouldSkip(stored, current, keyExists) {
  return !needsUpdate(stored, current) && keyExists;
}

/** Tree entries to an index branch: exactly the legacy format. */
export function buildBranch(branchName, entries) {
  const files = [];
  const directories = [];
  for (const entry of entries) {
    const path = entry.path ?? "";
    if (!path) continue;
    const name = path.split("/").pop();
    if (entry.type === "blob") {
      files.push({ name, path: `./${path}`, size: entry.size ?? 0 });
    } else if (entry.type === "tree") {
      directories.push({ name, path: `./${path}` });
    }
  }
  return { branch_name: branchName, files, directories };
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

  // Log split: the tally goes to stderr (colored console), the report to stdout (clean markdown for the Summary); output never contains repo names
  const say = (s) => console.error(s);
  const startedAt = Date.now();
  const counts = { total: 0, updated: 0, skipped: 0, warned: 0, pruned: 0 };
  const discoveredKeys = new Set();
  const existingKeys = new Set(await cfKvList(cfAccount, cfNamespace, cfToken));

  const repos = await ghRequest("/user/repos?affiliation=owner&sort=full_name", ghToken);
  for (const repo of repos) {
    const fullName = repo.full_name ?? "";
    if (!fullName || repo.archived || repo.disabled) continue;
    if (only.size > 0 && !only.has(fullName)) continue;
    counts.total += 1;
    if (blocklist.has(fullName)) {
      counts.skipped += 1;
      continue;
    }
    const shortName = fullName.split("/").pop();
    discoveredKeys.add(`${shortName}-index`);

    const branchList = await ghRequest(`/repos/${fullName}/branches`, ghToken, "branches");
    const current = Object.fromEntries(
      branchList.filter((b) => b.name && b.commit).map((b) => [b.name, b.commit.sha]),
    );
    if (Object.keys(current).length === 0) {
      counts.skipped += 1;
      continue;
    }
    if (shouldSkip(shaTable[fullName], current, existingKeys.has(`${shortName}-index`))) {
      counts.skipped += 1;
      continue;
    }

    const branchesData = [];
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
      branchesData.push(buildBranch(branchName, tree.tree ?? []));
    }
    if (treeFailed) {
      counts.warned += 1;
      continue;
    }
    const index = { repository: fullName, repository_short_name: shortName, branches: branchesData };
    await cfKvPut(cfAccount, cfNamespace, cfToken, `${shortName}-index`, index, dryRun);
    if (!dryRun) shaTable[fullName] = current;
    counts.updated += 1;
  }

  // Prune stale keys: -index suffixed but no longer discovered (repo-info-cache and friends stay untouched)
  for (const key of existingKeys) {
    if (key.endsWith("-index") && !discoveredKeys.has(key)) {
      await cfKvDelete(cfAccount, cfNamespace, cfToken, key, dryRun);
      counts.pruned += 1;
    }
  }

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
  const tally = `${counts.updated} updated · ${counts.skipped} skipped · ${counts.warned} warned · ${counts.pruned} pruned · ${seconds}s`;
  say(
    cyan(`${counts.total} repos: `) +
      green(`${counts.updated} updated`) +
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
