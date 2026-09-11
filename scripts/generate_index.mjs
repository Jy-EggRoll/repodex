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
const REPO_INFO_CACHE_KEY = "repo-info-cache";

// 终端颜色：只走 stderr（控制台日志），stdout 专供 Summary 纯净 markdown
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

/** 只有 SHA 一致且索引 key 真实存在，才算可跳过（防静默漏索引）。 */
export function shouldSkip(stored, current, keyExists) {
  return !needsUpdate(stored, current) && keyExists;
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

/** 仓库列表转 RepoInfo：与 Worker 旧 getAllRepos 输出形状一致，不过滤（归档也保留）。 */
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
    // 文件不存在 = 空黑名单
  }

  const storedTable = (await cfKvGet(cfAccount, cfNamespace, cfToken, SHA_TABLE_KEY)) ?? {};
  const shaTable = typeof storedTable === "object" && storedTable !== null ? storedTable : {};

  // 日志分流：动态走 stderr（控制台彩色），报表走 stdout（Summary 纯净 markdown）
  const say = (s) => console.error(s);
  const startedAt = Date.now();
  const counts = { updated: 0, skipped: 0, warned: 0, pruned: 0 };
  const summary = [];
  const discoveredKeys = new Set();
  const existingKeys = new Set(await cfKvList(cfAccount, cfNamespace, cfToken));

  const repos = await ghRequest("/user/repos?affiliation=owner&sort=full_name", ghToken);
  for (const repo of repos) {
    const fullName = repo.full_name ?? "";
    if (!fullName || repo.archived || repo.disabled) continue;
    if (blocklist.has(fullName)) {
      say(gray(`→ ${fullName} 黑名单跳过`));
      summary.push([fullName, "黑名单跳过"]);
      counts.skipped += 1;
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
      say(gray(`→ ${fullName} 无分支跳过`));
      summary.push([fullName, "无分支跳过"]);
      counts.skipped += 1;
      continue;
    }
    if (shouldSkip(shaTable[fullName], current, existingKeys.has(`${shortName}-index`))) {
      say(gray(`→ ${fullName} 无变化跳过`));
      summary.push([fullName, "无变化跳过"]);
      counts.skipped += 1;
      continue;
    }

    say(`Indexing ${fullName} (${Object.keys(current).length} branches)...`);
    const branchesData = [];
    let skipped = false;
    for (const [branchName, headSha] of Object.entries(current).sort()) {
      const tree = await ghRequest(`/repos/${fullName}/git/trees/${headSha}?recursive=1`, ghToken);
      if (typeof tree !== "object" || tree === null || Array.isArray(tree)) {
        say(yellow(`  WARN ${fullName}@${branchName}: 文件树返回异常，本轮跳过`));
        skipped = true;
        break;
      }
      if (tree.truncated) {
        say(yellow(`  WARN ${fullName}@${branchName}: 文件树超限，本轮跳过（需手动处理）`));
        skipped = true;
        break;
      }
      branchesData.push(buildBranch(branchName, tree.tree ?? []));
    }
    if (skipped) {
      summary.push([fullName, "文件树超限跳过"]);
      counts.warned += 1;
      continue;
    }
    const index = { repository: fullName, repository_short_name: shortName, branches: branchesData };
    await cfKvPut(cfAccount, cfNamespace, cfToken, `${shortName}-index`, index, dryRun);
    const nFiles = branchesData.reduce((n, b) => n + b.files.length, 0);
    if (!dryRun) shaTable[fullName] = current;
    say(green(`✓ ${fullName} 已更新（${nFiles} 文件）`));
    summary.push([fullName, `已更新（${nFiles} 文件）`]);
    counts.updated += 1;
  }

  // 清理僵尸 key：-index 后缀但已不在本次发现集合里（repo-info-cache 等不动）
  for (const key of existingKeys) {
    if (key.endsWith("-index") && !discoveredKeys.has(key)) {
      say(yellow(`Pruning stale key ${key}...`));
      await cfKvDelete(cfAccount, cfNamespace, cfToken, key, dryRun);
      summary.push([key, "僵尸索引已清理"]);
      counts.pruned += 1;
    }
  }

  if (!dryRun) await cfKvPut(cfAccount, cfNamespace, cfToken, SHA_TABLE_KEY, shaTable, dryRun);

  // 仓库列表快照：全量同步时覆盖，不过滤（与旧 Worker 直查行为一致）；手动单仓补跑时跳过防误删
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
    say(green(`✓ 仓库列表已更新（${repoInfos.length} 个）`));
  } else {
    say(gray("→ 单仓补跑跳过仓库列表更新"));
  }

  const seconds = Math.round((Date.now() - startedAt) / 1000);
  say(
    green(`${counts.updated} 更新`) +
      gray(` · ${counts.skipped} 跳过`) +
      yellow(` · ${counts.warned} 警告 · ${counts.pruned} 清理`) +
      cyan(` · 用时 ${seconds}s`),
  );
  console.log("## 索引同步结果\n");
  console.log(
    `${counts.updated} 更新 · ${counts.skipped} 跳过 · ${counts.warned} 警告 · ${counts.pruned} 清理 · 用时 ${seconds}s\n`,
  );
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
