// 中央索引生成器：发现仓库 -> SHA 比对 -> 增量生成索引 -> 推送 KV -> 清理僵尸 key。
//
// 零依赖（Node 18+ 内置 fetch）。所需环境变量：
//   REPOS_PAT        GitHub 细粒度 PAT（Contents: 只读 + Metadata: 只读，选 All repositories）
//   CF_API_TOKEN     Cloudflare API Token（需 Workers KV Storage 写权限）
//   CF_ACCOUNT_ID    Cloudflare Account ID
//   CF_NAMESPACE_ID  Cloudflare KV Namespace ID
//   REPOS_ONLY       可选，逗号分隔的 owner/repo，仅处理这些仓库（手动补跑用）
//   DRY_RUN          可选，设为 1 时只打印计划，不写 KV

const GH_API = "https://api.github.com";
const CF_API = "https://api.cloudflare.com/client/v4";
const SHA_TABLE_KEY = "__meta-sha-table";

function required(name) {
  const value = (process.env[name] ?? "").trim();
  if (!value) {
    console.error(`Missing required env: ${name}`);
    process.exit(1);
  }
  return value;
}

async function ghRequest(path, token) {
  // 调 GitHub API，自动翻页：列表拼起来，字典直接返回。
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
      console.error(`GitHub API failed: ${path} -> HTTP ${res.status}`);
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
    console.error(`KV GET failed: ${key} -> HTTP ${res.status}`);
    process.exit(1);
  }
  return res.json();
}

async function cfKvPut(account, namespace, token, key, value, dryRun) {
  if (dryRun) {
    console.log(`  [dry-run] skip PUT ${key}`);
    return;
  }
  const res = await fetch(`${CF_API}/accounts/${account}/storage/kv/namespaces/${namespace}/values/${key}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(value),
  });
  if (!res.ok) {
    console.error(`KV PUT failed: ${key} -> HTTP ${res.status}`);
    process.exit(1);
  }
  const result = await res.json();
  if (result.success === false) {
    console.error(`KV PUT returned success=false: ${key}`);
    process.exit(1);
  }
}

async function cfKvDelete(account, namespace, token, key, dryRun) {
  if (dryRun) {
    console.log(`  [dry-run] skip DELETE ${key}`);
    return;
  }
  const res = await fetch(`${CF_API}/accounts/${account}/storage/kv/namespaces/${namespace}/values/${key}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    console.error(`KV DELETE failed: ${key} -> HTTP ${res.status}`);
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

/** repos-blocklist.txt：每行一个 owner/repo，# 开头和空行忽略。 */
export function parseBlocklist(text) {
  return new Set(
    text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#")),
  );
}

/** SHA 表一致则无变化，可跳过。 */
export function needsUpdate(stored, current) {
  const a = stored ?? {};
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(current);
  if (aKeys.length !== bKeys.length) return true;
  return bKeys.some((k) => a[k] !== current[k]);
}

/** 文件树条目转索引分支：与老格式完全一致。 */
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
    // 文件不存在 = 空黑名单
  }

  const storedTable = (await cfKvGet(cfAccount, cfNamespace, cfToken, SHA_TABLE_KEY)) ?? {};
  const shaTable = typeof storedTable === "object" && storedTable !== null ? storedTable : {};

  const summary = [];
  const discoveredKeys = new Set();

  const repos = await ghRequest("/user/repos?affiliation=owner&sort=full_name", ghToken);
  for (const repo of repos) {
    const fullName = repo.full_name ?? "";
    if (!fullName || repo.archived || repo.disabled) continue;
    if (blocklist.has(fullName)) {
      summary.push([fullName, "黑名单跳过"]);
      continue;
    }
    if (only.size > 0 && !only.has(fullName)) continue;
    const shortName = fullName.split("/").pop();
    discoveredKeys.add(`${shortName}-index`);

    const branchList = await ghRequest(`/repos/${fullName}/branches`, ghToken);
    const current = Object.fromEntries(
      branchList.filter((b) => b.name && b.commit).map((b) => [b.name, b.commit.sha]),
    );
    if (Object.keys(current).length === 0) {
      summary.push([fullName, "无分支跳过"]);
      continue;
    }
    if (!needsUpdate(shaTable[fullName], current)) {
      summary.push([fullName, "无变化跳过"]);
      continue;
    }

    console.log(`Indexing ${fullName} (${Object.keys(current).length} branches)...`);
    const branchesData = [];
    let skipped = false;
    for (const [branchName, headSha] of Object.entries(current).sort()) {
      const tree = await ghRequest(`/repos/${fullName}/git/trees/${headSha}?recursive=1`, ghToken);
      if (typeof tree !== "object" || tree === null || Array.isArray(tree)) {
        console.log(`  WARN ${fullName}@${branchName}: 文件树返回异常，本轮跳过`);
        skipped = true;
        break;
      }
      if (tree.truncated) {
        console.log(`  WARN ${fullName}@${branchName}: 文件树超限，本轮跳过（需手动处理）`);
        skipped = true;
        break;
      }
      branchesData.push(buildBranch(branchName, tree.tree ?? []));
    }
    if (skipped) {
      summary.push([fullName, "文件树超限跳过"]);
      continue;
    }
    const index = { repository: fullName, repository_short_name: shortName, branches: branchesData };
    await cfKvPut(cfAccount, cfNamespace, cfToken, `${shortName}-index`, index, dryRun);
    const nFiles = branchesData.reduce((n, b) => n + b.files.length, 0);
    if (!dryRun) shaTable[fullName] = current;
    summary.push([fullName, `已更新（${nFiles} 文件）`]);
  }

  // 清理僵尸 key：-index 后缀但已不在本次发现集合里（repo-info-cache 等不动）
  for (const key of await cfKvList(cfAccount, cfNamespace, cfToken)) {
    if (key.endsWith("-index") && !discoveredKeys.has(key)) {
      console.log(`Pruning stale key ${key}...`);
      await cfKvDelete(cfAccount, cfNamespace, cfToken, key, dryRun);
      summary.push([key, "僵尸索引已清理"]);
    }
  }

  if (!dryRun) await cfKvPut(cfAccount, cfNamespace, cfToken, SHA_TABLE_KEY, shaTable, dryRun);

  console.log("\n## 索引同步结果\n");
  console.log("| 仓库 | 状态 |");
  console.log("| --- | --- |");
  for (const [name, status] of summary) console.log(`| ${name} | ${status} |`);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
