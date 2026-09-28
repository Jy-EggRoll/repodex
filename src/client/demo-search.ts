/**
 * Demo data source: the production search pipeline (`runSearch` / `runRepoList` in src/search-core.ts)
 * running over an in-memory KV view of the synthesized corpus. Scoring, ranking, highlighting, paging,
 * caps and error codes all come from production; only the bytes behind `get(key)` and the outbound
 * links are demo-specific.
 */

import { chunkBranchItems, encodeChunk, type ChunkItem } from "../chunk";
import { riskForSize } from "../risk";
import {
  PLAN_KEY,
  runRepoList,
  runSearch,
  type KvGet,
  type Outcome,
  type PlanChunk,
  type PlanRepo,
  type SearchPlan,
} from "../search-core";
import type { RepoInfo } from "../types";
import { ApiError, translateError, type SearchResponse } from "./api";
import { buildDemoCorpus, DEMO_SEED, type DemoRepo } from "./demo-corpus";
import { t } from "./i18n";
import { PAGE_SIZE } from "./ui";

/** Every demo result and repository links here: the fictional corpus has no repository of its own. */
export const DEMO_GITHUB = "https://github.com/Jy-EggRoll/repodex";

// The corpus is deterministic, so its plan must be too; the seed 20260910 is the date 2026-09-10.
const DEMO_PLAN_TS = Date.UTC(2026, 8, 10);

let corpusCache: DemoRepo[] | null = null;

/** One corpus per module, shared by `listRepos` and the KV view (same seed, same bytes every call). */
function corpus(): DemoRepo[] {
  corpusCache ??= buildDemoCorpus(DEMO_SEED);
  return corpusCache;
}

let kvCache: Map<string, string> | null = null;

/**
 * In-memory KV view of the corpus: `__meta-plan` plus one `{owner}/{repo}@{i}` chunk per production
 * layout. The payload contract (`[[t, path] | [t, path, size], ...]`, t=0 file / t=1 directory, name
 * derived from the path) is what `decodeChunk` reads; it is written with the same shared encoder and
 * chunking as `scripts/generate_index.mjs`, so both sides stay in step with that decoder.
 */
function demoKv(): Map<string, string> {
  if (kvCache) return kvCache;
  const map = new Map<string, string>();
  const chunks: PlanChunk[] = [];
  const repos: PlanRepo[] = [];
  for (const repo of corpus()) {
    let index = 0;
    let total = 0;
    // Same branch shape the generator's tree adapter produces: files first, then directories
    const branches = repo.branches.map((branch) => ({
      branch: branch.branch_name,
      items: [
        ...branch.files.map((f): ChunkItem => ({ type: "file", path: f.path, size: f.size })),
        ...branch.directories.map((d): ChunkItem => ({ type: "directory", path: d.path })),
      ],
    }));
    for (const segment of chunkBranchItems(branches)) {
      const k = `${repo.repository}@${index}`;
      map.set(k, JSON.stringify(encodeChunk(segment.items)));
      chunks.push({ k, r: repo.repository, b: segment.branch, n: segment.items.length });
      index += 1;
      total += segment.items.length;
    }
    // No `t` (last push time): the corpus has no real freshness, so recency stays neutral (`recencyBoost` returns 1).
    repos.push({ r: repo.repository, n: total });
  }
  const plan: SearchPlan = { v: 3, chunks, repos, ts: DEMO_PLAN_TS };
  map.set(PLAN_KEY, JSON.stringify(plan));
  kvCache = map;
  return map;
}

/** KV read for the shared pipeline: the corpus is local, so every key resolves from the cached map. */
const demoGet: KvGet = (key) => Promise.resolve(demoKv().get(key) ?? null);

/** Index selector list from production's `runRepoList`, so names and their order cannot drift. */
export async function listIndexes(): Promise<string[]> {
  const outcome = await runRepoList(demoGet);
  return JSON.parse(outcome.json) as string[];
}

export function listRepos(): RepoInfo[] {
  return corpus().map((r) => {
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

/** Same translation the fetch path applies to a failed response body (see `translateError` in api.ts). */
function errorMessage(outcome: Outcome): string {
  return translateError(JSON.parse(outcome.json) as { error?: string }, outcome.status);
}

/** Search via the production pipeline; failures keep production's codes (400/404/503) and translated text. */
export async function searchIndexes(
  q: string,
  fileParam: string,
  mode: "path" | "name",
  limit = PAGE_SIZE,
  offset = 0,
): Promise<SearchResponse> {
  const outcome = await runSearch(demoGet, {
    q,
    file: fileParam,
    mode,
    limit: String(limit),
    offset: String(offset),
  });
  if (outcome.status !== 200) throw new ApiError(outcome.status, errorMessage(outcome));
  const body = JSON.parse(outcome.json) as SearchResponse;

  // Thin adaptation, not logic: the pipeline derives `github.com/{repository}/{tree|blob}/...` links,
  // which for this fictional corpus would point at repositories that do not exist. Every result links
  // the demo repository instead, like `listRepos`'s html_url.
  return { ...body, results: body.results.map((r) => ({ ...r, github_url: DEMO_GITHUB })) };
}
