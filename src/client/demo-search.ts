/** Demo data source: same matching entry point, same rank function, and same highlight builder as production — only the data source becomes a locally synthesized corpus. */

import { buildHighlighted } from "../highlight";
import { matchRanges } from "../match";
import { compareRank, rankKeyFromRanges, type RankKey } from "../rank";
import { riskForSize } from "../risk";
import type { RepoInfo, SearchResult } from "../types";
import type { SearchResponse } from "./api";
import { buildDemoCorpus } from "./demo-corpus";
import { t } from "./i18n";

const DEMO_GITHUB = "https://github.com/Jy-EggRoll/repodex";

export function listIndexes(): string[] {
  return buildDemoCorpus().map((r) => r.repository);
}

export function listRepos(): RepoInfo[] {
  return buildDemoCorpus().map((r) => {
    const size_mb = Math.round((r.sizeKb / 1024) * 100) / 100;
    return {
      full_name: r.repository,
      size: r.sizeKb,
      size_mb,
      risk: riskForSize(size_mb),
      description: t("Demo data, not a real repository"),
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
    const key = repo.repository;
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
        const ranges = matchRanges(target, query);
        if (!ranges) continue;
        // Same length unit as the ranges (UTF-16 code units), matching the production pipeline
        const tKey = rankKeyFromRanges(ranges, target.length);
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
    const ranges = matchRanges(target, query) ?? [];
    const highlighted = buildHighlighted(target, ranges);
    return mode === "name"
      ? { ...item, highlightedName: highlighted }
      : { ...item, highlightedPath: highlighted };
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
