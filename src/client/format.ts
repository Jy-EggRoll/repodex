import type { RepoInfo, SearchResult } from "./api";

/** 仓库体积（KB）转 MB 文本。 */
export function formatRepoSize(repo: RepoInfo): string {
  return typeof repo.size_mb === "number" && !Number.isNaN(repo.size_mb)
    ? `${repo.size_mb} MB`
    : `${((repo.size || 0) / 1024).toFixed(2)} MB`;
}

/** 文件体积（bytes）转 MB 文本。 */
export function formatFileSize(item: SearchResult): string {
  if (typeof item.size === "number" && !Number.isNaN(item.size)) {
    return `${Math.round((item.size / 1024 / 1024) * 100) / 100} MB`;
  }
  if (typeof item.size_mb === "number" && !Number.isNaN(item.size_mb)) {
    return `${item.size_mb} MB`;
  }
  return "-";
}
