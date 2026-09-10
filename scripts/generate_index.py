"""中央索引生成器：发现仓库 -> SHA 比对 -> 增量生成索引 -> 推送 KV -> 清理僵尸 key。

只依赖 Python 标准库。所需环境变量：
  REPOS_PAT        GitHub 细粒度 PAT（Contents: 只读 + Metadata: 只读，选 All repositories）
  CF_API_TOKEN     Cloudflare API Token（需 Workers KV Storage 写权限）
  CF_ACCOUNT_ID    Cloudflare Account ID
  CF_NAMESPACE_ID  Cloudflare KV Namespace ID
  REPOS_ONLY       可选，逗号分隔的 owner/repo，仅处理这些仓库（手动补跑用）
  DRY_RUN          可选，设为 1 时只打印计划，不写 KV
"""

import json
import os
import sys
import urllib.request
import urllib.error

GH_API = "https://api.github.com"
CF_API = "https://api.cloudflare.com/client/v4"
SHA_TABLE_KEY = "__meta-sha-table"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPT_DIR)


def getenv(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        print(f"Missing required env: {name}", file=sys.stderr)
        sys.exit(1)
    return value


def gh_request(path: str, token: str):
    """调 GitHub API，自动翻页，返回合并后的 JSON（列表拼起来，字典直接返回）。"""
    result = None
    page = 1
    while True:
        url = f"{GH_API}{path}{'&' if '?' in path else '?'}per_page=100&page={page}"
        req = urllib.request.Request(
            url,
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.load(resp)
        except urllib.error.HTTPError as e:
            print(f"GitHub API failed: {path} -> HTTP {e.code}", file=sys.stderr)
            sys.exit(1)
        if isinstance(data, list):
            result = (result or []) + data
            if len(data) < 100:
                return result
            page += 1
        else:
            return data


def cf_kv_get(account: str, namespace: str, token: str, key: str):
    req = urllib.request.Request(
        f"{CF_API}/accounts/{account}/storage/kv/namespaces/{namespace}/values/{key}",
        headers={"Authorization": f"Bearer {token}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        print(f"KV GET failed: {key} -> HTTP {e.code}", file=sys.stderr)
        sys.exit(1)


def cf_kv_put(
    account: str, namespace: str, token: str, key: str, value: dict, dry_run: bool
):
    if dry_run:
        print(f"  [dry-run] skip PUT {key}")
        return
    body = json.dumps(value, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        f"{CF_API}/accounts/{account}/storage/kv/namespaces/{namespace}/values/{key}",
        data=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json; charset=utf-8",
        },
        method="PUT",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            result = json.load(resp)
    except urllib.error.HTTPError as e:
        print(f"KV PUT failed: {key} -> HTTP {e.code}", file=sys.stderr)
        sys.exit(1)
    if not result.get("success", False):
        print(f"KV PUT returned success=false: {key} -> {result}", file=sys.stderr)
        sys.exit(1)


def cf_kv_delete(account: str, namespace: str, token: str, key: str, dry_run: bool):
    if dry_run:
        print(f"  [dry-run] skip DELETE {key}")
        return
    req = urllib.request.Request(
        f"{CF_API}/accounts/{account}/storage/kv/namespaces/{namespace}/values/{key}",
        headers={"Authorization": f"Bearer {token}"},
        method="DELETE",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            json.load(resp)
    except urllib.error.HTTPError as e:
        print(f"KV DELETE failed: {key} -> HTTP {e.code}", file=sys.stderr)
        sys.exit(1)


def cf_kv_list(account: str, namespace: str, token: str) -> list:
    req = urllib.request.Request(
        f"{CF_API}/accounts/{account}/storage/kv/namespaces/{namespace}/keys?limit=1000",
        headers={"Authorization": f"Bearer {token}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.load(resp)
    except urllib.error.HTTPError as e:
        print(f"KV LIST failed -> HTTP {e.code}", file=sys.stderr)
        sys.exit(1)
    if not result.get("success", False):
        print(f"KV LIST returned success=false -> {result}", file=sys.stderr)
        sys.exit(1)
    return [k["name"] for k in result.get("result", [])]


def load_blocklist() -> set:
    """repos-blocklist.txt：每行一个 owner/repo，# 开头和空行忽略。"""
    path = os.path.join(REPO_ROOT, "repos-blocklist.txt")
    blocked = set()
    if not os.path.exists(path):
        return blocked
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#"):
                blocked.add(line)
    return blocked


def build_index(full_name: str, short_name: str, branches: list, gh_token: str):
    """对有变化的仓库：逐分支拉文件树，生成与老格式完全一致的索引。"""
    branches_data = []
    for branch_name, head_sha in branches:
        tree = gh_request(
            f"/repos/{full_name}/git/trees/{head_sha}?recursive=1", gh_token
        )
        if not isinstance(tree, dict):
            print(f"  WARN {full_name}@{branch_name}: 文件树返回异常，本轮跳过")
            return None
        if tree.get("truncated"):
            print(
                f"  WARN {full_name}@{branch_name}: 文件树超限，本轮跳过（需手动处理）"
            )
            return None
        files, directories = [], []
        for entry in tree.get("tree", []):
            path = entry.get("path", "")
            if not path:
                continue
            name = os.path.basename(path)
            if entry.get("type") == "blob":
                files.append(
                    {
                        "name": name,
                        "path": f"./{path}",
                        "size": entry.get("size", 0) or 0,
                    }
                )
            elif entry.get("type") == "tree":
                directories.append({"name": name, "path": f"./{path}"})
        branches_data.append(
            {"branch_name": branch_name, "files": files, "directories": directories}
        )
    return {
        "repository": full_name,
        "repository_short_name": short_name,
        "branches": branches_data,
    }


def main() -> None:
    gh_token = getenv("REPOS_PAT")
    cf_token = getenv("CF_API_TOKEN")
    cf_account = getenv("CF_ACCOUNT_ID")
    cf_namespace = getenv("CF_NAMESPACE_ID")
    only = {r.strip() for r in os.environ.get("REPOS_ONLY", "").split(",") if r.strip()}
    dry_run = os.environ.get("DRY_RUN", "") == "1"

    blocked = load_blocklist()
    sha_table = cf_kv_get(cf_account, cf_namespace, cf_token, SHA_TABLE_KEY) or {}
    if not isinstance(sha_table, dict):
        sha_table = {}

    summary = []  # (repo, status)
    discovered_keys = set()

    repos = gh_request("/user/repos?affiliation=owner&sort=full_name", gh_token)
    for repo in repos:
        full_name = repo.get("full_name", "")
        if not full_name or repo.get("archived") or repo.get("disabled"):
            continue
        if full_name in blocked:
            summary.append((full_name, "黑名单跳过"))
            continue
        if only and full_name not in only:
            continue
        short_name = full_name.split("/")[-1]
        discovered_keys.add(f"{short_name}-index")

        branch_list = gh_request(f"/repos/{full_name}/branches", gh_token)
        current = {
            b["name"]: b["commit"]["sha"]
            for b in branch_list
            if "name" in b and "commit" in b
        }
        if not current:
            summary.append((full_name, "无分支跳过"))
            continue
        if sha_table.get(full_name) == current:
            summary.append((full_name, "无变化跳过"))
            continue

        print(f"Indexing {full_name} ({len(current)} branches)...")
        index = build_index(full_name, short_name, sorted(current.items()), gh_token)
        if index is None:
            summary.append((full_name, "文件树超限跳过"))
            continue
        cf_kv_put(
            cf_account, cf_namespace, cf_token, f"{short_name}-index", index, dry_run
        )
        n_files = sum(len(b["files"]) for b in index["branches"])
        if not dry_run:
            sha_table[full_name] = current
        summary.append((full_name, f"已更新（{n_files} 文件）"))

    # 清理僵尸 key：-index 后缀但已不在本次发现集合里（repo-info-cache 等不动）
    for key in cf_kv_list(cf_account, cf_namespace, cf_token):
        if key.endswith("-index") and key not in discovered_keys:
            print(f"Pruning stale key {key}...")
            cf_kv_delete(cf_account, cf_namespace, cf_token, key, dry_run)
            summary.append((key, "僵尸索引已清理"))

    if not dry_run:
        cf_kv_put(cf_account, cf_namespace, cf_token, SHA_TABLE_KEY, sha_table, dry_run)

    print("\n## 索引同步结果\n")
    print("| 仓库 | 状态 |")
    print("| --- | --- |")
    for name, status in summary:
        print(f"| {name} | {status} |")


if __name__ == "__main__":
    main()
