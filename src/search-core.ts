import { chunk } from "./batch";
import { buildHighlighted } from "./highlight";
import { compareRank, rankKeyFromRanges, type RankKey } from "./rank";
import { search as tseSearch } from "text-search-engine";

// Pure search pipeline, deliberately free of Cloudflare runtime imports (KV access is injected
// through KvReader) so the whole matching/selection logic can run under vitest unchanged.

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

export interface KvReader {
  get(key: string): Promise<string | null>;
  list(): Promise<string[]>;
}

// Max items returned per response (prevents transport blowup); pairs with limit/offset paging to fetch everything
export const MAX_RESULTS = 1000;
// Match collection cap: stop once full and mark total as approximate; a fuse for short-query memory/CPU
export const SCORE_CAP = 1000;
// Load concurrency: bounded peak memory while streaming load -> scan -> discard
export const LOAD_CONCURRENCY = 6;
export const PLAN_KEY = "__meta-plan";

/** One index chunk: KV key, repository full/short name, branch name, item count. */
export interface PlanChunk {
  k: string;
  r: string;
  rs: string;
  b: string;
  n: number;
}

/** One repository present in the index (n=0 marks "exists but empty" so it is not a 404). */
export interface PlanRepo {
  r: string;
  rs: string;
  n: number;
}

export interface SearchPlan {
  v: 2;
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

export interface SearchResult {
  name: string;
  repository: string;
  branch: string;
  path: string;
  size: number | undefined;
  size_mb: number;
  type: "file" | "directory";
  github_url: string | undefined;
  ranges: Array<[number, number]>;
  score: number;
  highlightedPath?: string;
  highlightedName?: string;
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

/** Legacy index file shape (untrusted input; the old parsing quirks are kept on purpose). */
interface LegacyIndex {
  repository?: unknown;
  branches?: unknown;
}
interface LegacyBranch {
  branch_name?: unknown;
  files?: unknown;
  directories?: unknown;
}
interface LegacyFile {
  name?: unknown;
  path?: unknown;
  size?: unknown;
}
interface LegacyDir {
  path?: unknown;
}

export function basename(p: string): string {
  if (!p) return "";
  p = p.replace(/^\.\//, "").replace(/^\//, "");
  const parts = p.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : p;
}

/** Plan is the single source of truth for chunk layout; anything malformed degrades to the legacy path. */
export function parsePlan(text: string | null): SearchPlan | null {
  if (!text) return null;
  try {
    const raw = JSON.parse(text) as { v?: unknown; chunks?: unknown; repos?: unknown; ts?: unknown };
    if (!raw || typeof raw !== "object" || raw.v !== 2) return null;
    if (!Array.isArray(raw.chunks) || !Array.isArray(raw.repos)) return null;
    return {
      v: 2,
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
    typeof o.k === "string" &&
    typeof o.r === "string" &&
    typeof o.rs === "string" &&
    typeof o.b === "string" &&
    typeof o.n === "number"
  );
}

function isPlanRepo(r: unknown): r is PlanRepo {
  if (!r || typeof r !== "object") return false;
  const o = r as Record<string, unknown>;
  return typeof o.r === "string" && typeof o.rs === "string" && typeof o.n === "number";
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

/**
 * Legacy envelope -> flat entries, in the exact order (and with the exact per-file quirks) of the
 * old in-worker parser; corrupt branch entries throw so callers can decide between fail count and 500.
 */
export function parseLegacyInto(fj: unknown, out: IndexEntry[]): void {
  const idx = fj as LegacyIndex | null;
  if (!idx || !Array.isArray(idx.branches)) return;
  const repoName = (idx.repository as string) || "";
  for (const branch of idx.branches as LegacyBranch[]) {
    const branchName = (branch.branch_name as string) || "";
    if (Array.isArray(branch.files)) {
      for (const f of branch.files as LegacyFile[]) {
        const name = String(f.name || "");
        const rawPath = String(f.path || "")
          .replace(/^\.\//, "")
          .replace(/^\//, "");
        out.push({
          name,
          repository: repoName,
          branch: branchName,
          path: rawPath,
          size: f.size as number | undefined,
          type: "file",
        });
      }
    }
    if (Array.isArray(branch.directories)) {
      for (const d of branch.directories as LegacyDir[]) {
        const rawPath = String(d.path || "")
          .replace(/^\.\//, "")
          .replace(/^\//, "");
        out.push({
          name: basename(rawPath),
          repository: repoName,
          branch: branchName,
          path: rawPath,
          size: undefined,
          type: "directory",
        });
      }
    }
  }
}

export function parseLegacyIndex(fj: unknown): IndexEntry[] {
  const out: IndexEntry[] = [];
  parseLegacyInto(fj, out);
  return out;
}

/** Printable ASCII without whitespace (0x21-0x7E): the only inputs where the greedy prefilter is provably sound. */
export function isPlainAscii(s: string): boolean {
  if (!s) return false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x21 || c > 0x7e) return false;
  }
  return true;
}

function foldLower(c: number): number {
  return c >= 0x41 && c <= 0x5a ? c + 0x20 : c;
}

/**
 * Cheap sound prefilter: for plain-ASCII query and target, a library match implies a
 * case-insensitive ASCII subsequence, so a failed greedy scan proves there is no match and the DP can
 * be skipped. Anything else (CJK, pinyin, spaces, emoji) defers to the library — zero false negatives.
 */
export function canMaybeMatch(query: string, target: string): boolean {
  if (!isPlainAscii(query) || !isPlainAscii(target)) return true;
  let qi = 0;
  for (let ti = 0; ti < target.length && qi < query.length; ti++) {
    if (foldLower(target.charCodeAt(ti)) === foldLower(query.charCodeAt(qi))) qi++;
  }
  return qi === query.length;
}

/** Code-point length (Array.from) matches the old rank denominator; plain ASCII can skip the allocation. */
export function targetLength(target: string): number {
  return isPlainAscii(target) ? target.length : Array.from(target).length;
}

export function findPlanRepo(plan: SearchPlan, name: string): PlanRepo | null {
  for (const rp of plan.repos) {
    if (rp.rs && `${rp.rs}-index` === name) return rp;
  }
  return null;
}

export type Selection =
  | { kind: "all" }
  | { kind: "single"; name: string; known: boolean; chunks: PlanChunk[] }
  | { kind: "list"; names: string[] }
  | { kind: "invalid" };

/** Resolve the `file` parameter with the old quirks: "all"/empty means everything, single names may be invalid, lists drop bad entries and duplicate names. */
export function resolveSelection(fileRaw: string, plan: SearchPlan | null): Selection {
  const file = (fileRaw || "all").trim();
  if (file === "all" || !file) return { kind: "all" };
  if (file.includes(",")) {
    const seen = new Set<string>();
    const names: string[] = [];
    for (const part of file.split(",")) {
      const name = part.trim();
      if (!name || name.includes("..") || name.includes("/") || seen.has(name)) continue;
      seen.add(name);
      names.push(name);
    }
    return { kind: "list", names };
  }
  if (file.includes("..") || file.includes("/")) return { kind: "invalid" };
  const rp = plan ? findPlanRepo(plan, file) : null;
  return {
    kind: "single",
    name: file,
    known: rp !== null,
    chunks: rp && plan ? plan.chunks.filter((c) => c.rs === rp.rs) : [],
  };
}

export function errorOutcome(status: number, error: string): Outcome {
  return { status, json: JSON.stringify({ error }) };
}

export async function runSearch(kv: KvReader, spec: SearchSpec): Promise<Outcome> {
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

  // Phase 1: record rank keys only (index + numbers, no range coordinates) and tally files/folders;
  // stop at SCORE_CAP and mark total as approximate -- a fuse for short-query memory/CPU
  const scanEntries = (entries: IndexEntry[]): boolean => {
    const s0 = Date.now();
    let stop = false;
    for (const e of entries) {
      const target = mode === "name" ? e.name || "" : e.path || e.name || "";
      if (!target) continue;
      if (!canMaybeMatch(q, target)) continue;
      let key: RankKey | null = null;
      try {
        const ranges = tseSearch(target, q);
        if (!ranges) continue;
        key = rankKeyFromRanges(ranges, targetLength(target));
        if (!key) continue;
      } catch {
        continue; // matching library failures are swallowed, same as before
      }
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
      const values = await Promise.all(batch.map((d) => kv.get(d.k).catch(() => null)));
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
        if (scanEntries(entries)) {
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

  // Legacy envelopes: missing or unreadable keys are skipped silently (same as before); parse failures
  // count against loadFailCount while keeping whatever was parsed before the failure.
  const loadLegacyNames = async (names: string[], dedupe: Set<string> | null): Promise<boolean> => {
    for (const batch of chunk(names, LOAD_CONCURRENCY)) {
      const values = await Promise.all(batch.map((n) => kv.get(n).catch(() => null)));
      for (const text of values) {
        if (text == null) continue;
        let fj: unknown;
        try {
          fj = JSON.parse(text);
        } catch {
          continue;
        }
        let entries: IndexEntry[] = [];
        try {
          parseLegacyInto(fj, entries);
        } catch {
          loadFailCount += 1;
        }
        if (dedupe) {
          entries = entries.filter((e) => {
            const key = `${e.repository || ""}|${e.branch || ""}|${e.path || ""}|${e.type || ""}`;
            if (dedupe.has(key)) return false;
            dedupe.add(key);
            return true;
          });
        }
        itemsTotal += entries.length;
        for (const e of entries) indexSet.add(e.repository);
        if (scanEntries(entries)) return true;
      }
    }
    return false;
  };

  try {
    const plan = parsePlan(await kv.get(PLAN_KEY).catch(() => null));
    const selection = resolveSelection(file, plan);
    if (selection.kind === "invalid") return errorOutcome(400, "invalid file");

    if (selection.kind === "all") {
      const planChunks = plan ? plan.chunks : [];
      const planKeys = new Set<string>();
      if (plan) {
        for (const rp of plan.repos) if (rp.rs) planKeys.add(`${rp.rs}-index`);
        for (const c of plan.chunks) planKeys.add(`${c.rs}-index`);
      }
      let allNames: string[] = [];
      try {
        allNames = await kv.list();
      } catch {
        allNames = [];
      }
      // Repos already covered by the plan are read as chunks; anything else still lives in a legacy envelope
      const gap = allNames.filter((n) => n && n.endsWith("-index") && !planKeys.has(n));
      if (!(await loadChunks(planChunks))) await loadLegacyNames(gap, null);
    } else if (selection.kind === "single") {
      if (selection.known) {
        await loadChunks(selection.chunks);
      } else {
        // Distinguish "index missing" from "index empty": a readable envelope that parses to zero
        // items is a valid, empty result
        const text = await kv.get(selection.name).catch(() => null);
        if (text == null) return errorOutcome(404, "not found");
        let fj: unknown;
        try {
          fj = JSON.parse(text);
        } catch {
          return errorOutcome(404, "not found");
        }
        const entries: IndexEntry[] = [];
        parseLegacyInto(fj, entries); // corrupt entries throw -> outer catch -> 500
        itemsTotal += entries.length;
        for (const e of entries) indexSet.add(e.repository);
        scanEntries(entries);
      }
    } else {
      const dedupe = new Set<string>();
      for (const name of selection.names) {
        const rp = plan ? findPlanRepo(plan, name) : null;
        const stopped =
          plan && rp
            ? await loadChunks(plan.chunks.filter((c) => c.rs === rp.rs))
            : await loadLegacyNames([name], dedupe);
        if (stopped) break;
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
      const ranges = tseSearch(target, q) ?? [];
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
        ranges,
        score: s.key.matched,
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
