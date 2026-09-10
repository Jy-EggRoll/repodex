/** Demo 数据源：与线上同一匹配库 + 同一排名函数 + 同一高亮构建，仅数据源换成本地合成语料。 */

import { search as tseSearch } from "text-search-engine";
import { buildHighlighted } from "../highlight";
import { compareRank, rankKeyFromRanges, type RankKey } from "../rank";
import { riskForSize } from "../risk";
import type { RepoInfo, SearchResponse, SearchResult } from "./api";
import { buildDemoCorpus } from "./demo-corpus";

const DEMO_GITHUB = "https://github.com/Jy-EggRoll/repodex";

export function listIndexes(): string[] {
  return buildDemoCorpus().map((r) => `${r.repository_short_name}-index`);
}

export function listRepos(): RepoInfo[] {
  return buildDemoCorpus().map((r) => {
    const size_mb = Math.round((r.sizeKb / 1024) * 100) / 100;
    return {
      name: r.repository_short_name,
      size: r.sizeKb,
      size_mb,
      risk: riskForSize(size_mb),
      description: "演示数据，非真实仓库",
      html_url: DEMO_GITHUB,
    };
  });
}

export async function searchIndexes(
  q: string,
  fileParam: string,
  mode: "path" | "name",
  limit = 100,
  offset = 0,
): Promise<SearchResponse> {
  const t0 = performance.now();
  const query = q.trim();
  const wanted =
    fileParam === "all"
      ? null
      : new Set(
          fileParam
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        );

  const scored: Array<{ item: SearchResult; key: RankKey }> = [];
  let fileCount = 0;
  let dirCount = 0;
  let indexCount = 0;
  let itemsTotal = 0;

  for (const repo of buildDemoCorpus()) {
    const key = `${repo.repository_short_name}-index`;
    if (wanted && !wanted.has(key)) continue;
    indexCount += 1;
    for (const br of repo.branches) {
      const entries = [
        ...br.files.map((f) => ({ ...f, type: "file" as const })),
        ...br.directories.map((d) => ({ ...d, size: undefined, type: "directory" as const })),
      ];
      for (const e of entries) {
        itemsTotal += 1;
        const target = mode === "name" ? e.name : e.path.replace(/^\.\//, "");
        const ranges = tseSearch(target, query);
        if (!ranges) continue;
        const tKey = rankKeyFromRanges(ranges, Array.from(target).length);
        if (!tKey) continue;
        if (e.type === "directory") dirCount += 1;
        else fileCount += 1;
        const sizeBytes = Number(e.size) || 0;
        scored.push({
          item: {
            name: e.name,
            repository: repo.repository,
            branch: br.branch_name,
            path: e.path.replace(/^\.\//, ""),
            size: e.size,
            size_mb: Math.round((sizeBytes / 1024 / 1024) * 100) / 100,
            type: e.type,
            github_url: DEMO_GITHUB,
            ranges: [],
            score: tKey.matched,
          },
          key: tKey,
        });
      }
    }
  }
  const searchMs = Math.round(performance.now() - t0);

  scored.sort((a, b) => compareRank(a.key, b.key));
  const results = scored.slice(offset, offset + limit).map(({ item }) => {
    const target = mode === "name" ? item.name : item.path;
    const ranges = tseSearch(target, query) ?? [];
    const highlighted = buildHighlighted(target, ranges);
    const done: SearchResult = { ...item, ranges, score: item.score };
    if (mode === "name") done.highlightedName = highlighted;
    else done.highlightedPath = highlighted;
    return done;
  });

  return {
    results,
    total: scored.length,
    truncated: false,
    fileCount,
    dirCount,
    indexCount,
    itemsTotal,
    loadFailCount: 0,
    tookMs: Math.round(performance.now() - t0),
    loadMs: 0,
    searchMs,
  };
}
