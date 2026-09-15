/** Rank key: derived directly from the ranges returned by the matching library, at zero extra matching cost. */
export interface RankKey {
  matched: number;
  targetLen: number;
  firstPos: number;
  spans: number;
  /** Recency multiplier (1 = neutral): repository-level, bounded so relevance still dominates. */
  boost: number;
}

// Bounded recency boost: +50% for a fresh push, halving every 30 days.
export const RECENCY_MAX_BONUS = 0.5;
export const RECENCY_HALF_LIFE_DAYS = 30;

/** Boost for an entry whose repository was pushed at `pushedAtMs`; unknown timestamps are neutral. */
export function recencyBoost(pushedAtMs: number | undefined, nowMs: number): number {
  if (typeof pushedAtMs !== "number" || !Number.isFinite(pushedAtMs)) return 1;
  const ageDays = Math.max(0, nowMs - pushedAtMs) / 86400000;
  return 1 + RECENCY_MAX_BONUS * Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS);
}

export function rankKeyFromRanges(
  ranges: Array<[number, number]>,
  targetLen: number,
  boost = 1,
): RankKey | null {
  if (!ranges || ranges.length === 0 || targetLen <= 0) return null;
  let matched = 0;
  let firstPos = Infinity;
  for (const [s, e] of ranges) {
    matched += e - s + 1;
    if (s < firstPos) firstPos = s;
  }
  return { matched, targetLen, firstPos, spans: ranges.length, boost };
}

/**
 * Lexicographic ranking: boosted coverage desc -> first match position asc -> span count asc -> target length asc.
 * The bounded boost only flips close calls; large relevance gaps are never overturned.
 */
export function compareRank(a: RankKey, b: RankKey): number {
  const covA = (a.matched / a.targetLen) * a.boost;
  const covB = (b.matched / b.targetLen) * b.boost;
  if (covA !== covB) return covB - covA;
  if (a.firstPos !== b.firstPos) return a.firstPos - b.firstPos;
  if (a.spans !== b.spans) return a.spans - b.spans;
  return a.targetLen - b.targetLen;
}
