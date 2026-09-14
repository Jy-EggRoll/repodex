/** Rank key: derived directly from the ranges returned by the matching library, at zero extra matching cost. */
export interface RankKey {
  matched: number;
  targetLen: number;
  firstPos: number;
  spans: number;
}

export function rankKeyFromRanges(ranges: Array<[number, number]>, targetLen: number): RankKey | null {
  if (!ranges || ranges.length === 0 || targetLen <= 0) return null;
  let matched = 0;
  let firstPos = Infinity;
  for (const [s, e] of ranges) {
    matched += e - s + 1;
    if (s < firstPos) firstPos = s;
  }
  return { matched, targetLen, firstPos, spans: ranges.length };
}

/**
 * Lexicographic ranking (no weights, no magic numbers):
 * coverage desc -> first match position asc -> span count asc -> target length asc.
 */
export function compareRank(a: RankKey, b: RankKey): number {
  const covA = a.matched / a.targetLen;
  const covB = b.matched / b.targetLen;
  if (covA !== covB) return covB - covA;
  if (a.firstPos !== b.firstPos) return a.firstPos - b.firstPos;
  if (a.spans !== b.spans) return a.spans - b.spans;
  return a.targetLen - b.targetLen;
}
