import { chunk } from "./batch";
import { buildHighlighted } from "./highlight";
import { isPlainAscii, matchRanges } from "./match";
import { compareRank, rankKeyFromRanges, recencyBoost, type RankKey } from "./rank";
import type { SearchResult } from "./types";

// Pure search pipeline, deliberately free of Cloudflare runtime imports (KV access is injected
// through a get function) so the whole matching/selection logic can run under vitest unchanged.

/** Raw query-string values as received; parsing quirks are preserved inside runSearch. */
export interface SearchSpec {
  q: string;
  file: string;
  mode: string;
  limit: string;
  offset: string;
}

/** Serialized HTTP outcome; the root Worker relays `json` verbatim (re-serializing there would re-burn the 10ms budget). */
export interface Outcome {
  status: number;
  json: string;
}

/** Minimal KV access: the plan and its chunks are the only keys the engine reads. */
export type KvGet = (key: string) => Promise<string | null>;

// Max items returned per response (prevents transport blowup); pairs with limit/offset paging to fetch everything
export const MAX_RESULTS = 1000;
// Match collection cap: stop once full and mark total as approximate; a fuse for short-query memory/CPU
export const SCORE_CAP = 1000;
// Load concurrency: bounded peak memory while streaming load -> scan -> discard
export const LOAD_CONCURRENCY = 6;
export const PLAN_KEY = "__meta-plan";

/** One index chunk: KV key, repository full name (owner/repo), branch name, item count. */
export interface PlanChunk {
  k: string;
  r: string;
  b: string;
  n: number;
}

/** One repository in the index, identified by full name (owner/repo); n=0 marks "exists but empty" so it is not a 404 (t = last push time, epoch ms). */
export interface PlanRepo {
  r: string;
  n: number;
  t?: number;
}

export interface SearchPlan {
  // v3 writes `owner/repo` identifiers; v2 plans (short-name identifiers) are still served during the migration window
  v: 2 | 3;
  chunks: PlanChunk[];
  repos: PlanRepo[];
  ts: number;
}

export interface IndexEntry {
  name: string;
  repository: string;
  branch: string;
  path: string;
  size: number | undefined;
  type: "file" | "directory";
}

interface ScoredRef {
  key: RankKey;
  repository: string;
  branch: string;
  name: string;
  path: string;
  size: number | undefined;
  type: "file" | "directory";
}

export function basename(p: string): string {
  if (!p) return "";
  p = p.replace(/^\.\//, "").replace(/^\//, "");
  const parts = p.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : p;
}

/** Plan is the single source of truth for chunk layout; a missing or malformed plan returns null. */
export function parsePlan(text: string | null): SearchPlan | null {
  if (!text) return null;
  try {
    const raw = JSON.parse(text) as { v?: unknown; chunks?: unknown; repos?: unknown; ts?: unknown };
    if (!raw || typeof raw !== "object" || (raw.v !== 2 && raw.v !== 3)) return null;
    if (!Array.isArray(raw.chunks) || !Array.isArray(raw.repos)) return null;
    return {
      v: raw.v,
      chunks: raw.chunks.filter(isPlanChunk),
      repos: raw.repos.filter(isPlanRepo),
      ts: typeof raw.ts === "number" ? raw.ts : 0,
    };
  } catch {
    return null;
  }
}

function isPlanChunk(c: unknown): c is PlanChunk {
  if (!c || typeof c !== "object") return false;
  const o = c as Record<string, unknown>;
  return (
    typeof o.k === "string" && typeof o.r === "string" && typeof o.b === "string" && typeof o.n === "number"
  );
}

function isPlanRepo(r: unknown): r is PlanRepo {
  if (!r || typeof r !== "object") return false;
  const o = r as Record<string, unknown>;
  return typeof o.r === "string" && typeof o.n === "number";
}

/** Chunk payload: [[t, path] | [t, path, size], ...]; t=0 file, t=1 directory; name is derived, size omitted for directories. */
export function decodeChunk(text: string, repository: string, branch: string): IndexEntry[] {
  const raw: unknown = JSON.parse(text);
  if (!Array.isArray(raw)) throw new Error("chunk is not an array");
  const out: IndexEntry[] = [];
  for (const item of raw) {
    if (!Array.isArray(item)) throw new Error("chunk entry is not an array");
    const t = item[0];
    const path = item[1];
    if (typeof path !== "string") throw new Error("chunk entry has no path");
    if (t === 0) {
      out.push({
        name: basename(path),
        repository,
        branch,
        path,
        size: typeof item[2] === "number" ? item[2] : undefined,
        type: "file",
      });
    } else if (t === 1) {
      out.push({ name: basename(path), repository, branch, path, size: undefined, type: "directory" });
    } else {
      throw new Error("chunk entry has unknown type");
    }
  }
  return out;
}

/** Code-point length (Array.from) matches the old rank denominator; plain ASCII can skip the allocation. */
export function targetLength(target: string): number {
  return isPlainAscii(target) ? target.length : Array.from(target).length;
}

export function findPlanRepo(plan: SearchPlan, name: string): PlanRepo | null {
  for (const rp of plan.repos) {
    if (rp.r === name) return rp;
  }
  return null;
}

export type Selection =
  | { kind: "all" }
  | { kind: "single"; name: string; known: boolean; chunks: PlanChunk[] }
  | { kind: "list"; names: string[] }
  | { kind: "invalid" };

// Index identifiers are repository full names (owner/repo): exactly one slash, non-empty sides
const INDEX_NAME_RE = /^[^/]+\/[^/]+$/;

/** Resolve the `file` parameter with the old quirks: "all"/empty means everything, single names may be invalid, lists drop bad entries and duplicate names. */
export function resolveSelection(fileRaw: string, plan: SearchPlan): Selection {
  const file = (fileRaw || "all").trim();
  if (file === "all" || !file) return { kind: "all" };
  if (file.includes(",")) {
    const seen = new Set<string>();
    const names: string[] = [];
    for (const part of file.split(",")) {
      const name = part.trim();
      if (!INDEX_NAME_RE.test(name) || seen.has(name)) continue;
      seen.add(name);
      names.push(name);
    }
    return { kind: "list", names };
  }
  if (!INDEX_NAME_RE.test(file)) return { kind: "invalid" };
  const rp = findPlanRepo(plan, file);
  return {
    kind: "single",
    name: file,
    known: rp !== null,
    chunks: rp ? plan.chunks.filter((c) => c.r === rp.r) : [],
  };
}

export function errorOutcome(status: number, error: string): Outcome {
  return { status, json: JSON.stringify({ error }) };
}

export async function runSearch(get: KvGet, spec: SearchSpec): Promise<Outcome> {
  const q = (spec.q || "").trim();
  const file = (spec.file || "all").trim();
  if (!q) return errorOutcome(400, "empty query");
  // Paging: limit = page size (default 100, capped at MAX_RESULTS), offset = start index
  const limit = Math.min(Math.max(Number(spec.limit) || 100, 1), MAX_RESULTS);
  const offset = Math.max(Number(spec.offset) || 0, 0);
  const mode = (spec.mode || "path").trim();

  const t0 = Date.now();
  let scanMs = 0;
  let loadFailCount = 0;
  let itemsTotal = 0;
  let fileCount = 0;
  let dirCount = 0;
  let truncated = false;
  const indexSet = new Set<string>();
  const scored: ScoredRef[] = [];
  // Repo-level recency: every entry of a repository shares its last push time (unknown = neutral)
  const repoTs = new Map<string, number>();

  // Phase 1: record rank keys only (index + numbers, no range coordinates) and tally files/folders;
  // stop at SCORE_CAP and mark total as approximate -- a fuse for short-query memory/CPU
  const scanEntries = (entries: IndexEntry[], boost: number): boolean => {
    const s0 = Date.now();
    let stop = false;
    for (const e of entries) {
      const target = mode === "name" ? e.name || "" : e.path || e.name || "";
      if (!target) continue;
      const ranges = matchRanges(target, q);
      if (!ranges) continue;
      const key = rankKeyFromRanges(ranges, targetLength(target), boost);
      if (!key) continue;
      if (e.type === "directory") dirCount += 1;
      else fileCount += 1;
      scored.push({
        key,
        repository: e.repository,
        branch: e.branch,
        name: e.name,
        path: e.path,
        size: e.size,
        type: e.type,
      });
      if (scored.length >= SCORE_CAP) {
        truncated = true;
        stop = true;
        break;
      }
    }
    scanMs += Date.now() - s0;
    return stop;
  };

  // Batched streaming load: chunk is parsed, scanned, then discarded, keeping peak memory flat.
  const loadChunks = async (descs: PlanChunk[]): Promise<boolean> => {
    let done = 0;
    for (const batch of chunk(descs, LOAD_CONCURRENCY)) {
      const values = await Promise.all(batch.map((d) => get(d.k).catch(() => null)));
      for (let j = 0; j < batch.length; j++) {
        const d = batch[j];
        const text = values[j];
        if (text == null) {
          loadFailCount += 1; // the plan promised this chunk
          continue;
        }
        let entries: IndexEntry[];
        try {
          entries = decodeChunk(text, d.r, d.b);
        } catch {
          loadFailCount += 1;
          continue;
        }
        itemsTotal += d.n;
        if (entries.length > 0) indexSet.add(d.r);
        if (scanEntries(entries, recencyBoost(repoTs.get(d.r), t0))) {
          // Cap reached: account for the still-selected chunks from the plan so telemetry matches
          // the old "load the whole corpus first" behavior
          for (let k = done + j + 1; k < descs.length; k++) {
            itemsTotal += descs[k].n;
            indexSet.add(descs[k].r);
          }
          return true;
        }
      }
      done += batch.length;
    }
    return false;
  };

  try {
    const plan = parsePlan(await get(PLAN_KEY).catch(() => null));
    if (!plan) return errorOutcome(503, "index not ready, run Central Repository Index workflow first");
    for (const rp of plan.repos) {
      if (typeof rp.t === "number" && Number.isFinite(rp.t)) repoTs.set(rp.r, rp.t);
    }
    const selection = resolveSelection(file, plan);
    if (selection.kind === "invalid") return errorOutcome(400, "invalid file");

    if (selection.kind === "all") {
      await loadChunks(plan.chunks);
    } else if (selection.kind === "single") {
      if (!selection.known) return errorOutcome(404, "not found");
      await loadChunks(selection.chunks);
    } else {
      for (const name of selection.names) {
        const rp = findPlanRepo(plan, name);
        if (!rp) continue; // unknown names are dropped silently, same as the old per-name loads
        if (await loadChunks(plan.chunks.filter((c) => c.r === rp.r))) break;
      }
    }

    const tEnd = Date.now();
    const loadMs = Math.max(tEnd - t0 - scanMs, 0);
    const searchMs = scanMs;

    // Phase 2: after sorting, take the offset/limit page and re-run matching only for this page's
    // items to build highlight ranges
    scored.sort((a, b) => compareRank(a.key, b.key));
    const page = scored.slice(offset, offset + limit).slice(0, MAX_RESULTS);
    const results: SearchResult[] = page.map((s) => {
      const target = mode === "name" ? s.name || "" : s.path || s.name || "";
      const ranges = matchRanges(target, q) ?? [];
      const highlighted = buildHighlighted(target, ranges);

      const size_bytes = Number(s.size) || 0;
      const size_mb = Math.round((size_bytes / 1024 / 1024) * 100) / 100;
      const type = s.type || (size_bytes > 0 ? "file" : "directory");
      const github_url =
        s.repository && s.branch && s.path
          ? `https://github.com/${s.repository}/${s.type === "directory" ? "tree" : "blob"}/${s.branch}/${s.path}`
          : undefined;

      const result: SearchResult = {
        name: s.name,
        repository: s.repository,
        branch: s.branch,
        path: s.path,
        size: s.size,
        size_mb,
        type,
        github_url,
      };
      if (mode === "name") result.highlightedName = highlighted;
      else result.highlightedPath = highlighted;
      return result;
    });

    const tookMs = Date.now() - t0;
    const indexCount = indexSet.size;
    console.log(
      `[search] q=${q} file=${file} mode=${mode} total=${scored.length}${truncated ? "+" : ""} ` +
        `offset=${offset} limit=${limit} ` +
        `tookMs=${tookMs} loadMs=${loadMs} searchMs=${searchMs} ` +
        `indexes=${indexCount} items=${itemsTotal} fail=${loadFailCount}`,
    );
    return {
      status: 200,
      json: JSON.stringify({
        results,
        total: scored.length,
        truncated,
        fileCount,
        dirCount,
        indexCount,
        itemsTotal,
        loadFailCount,
        tookMs,
        loadMs,
        searchMs,
      }),
    };
  } catch (err) {
    return errorOutcome(500, String(err));
  }
}

/** Index selector list for /api/repo-list: repository full names (owner/repo) from the plan (empty before the first sync). */
export async function runRepoList(get: KvGet): Promise<Outcome> {
  const plan = parsePlan(await get(PLAN_KEY).catch(() => null));
  const names = plan ? plan.repos.map((rp) => rp.r) : [];
  return { status: 200, json: JSON.stringify(names) };
}
