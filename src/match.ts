import { search as tseSearch } from "text-search-engine";

// Single matching entry point shared by the worker search, the demo search and the client-side
// filters, so every place that matches a query against text behaves identically: same prefilter,
// same library call, same failure handling.

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

/** Match `query` against `target`; null when either is empty or the library finds nothing. Matching failures are swallowed. */
export function matchRanges(target: string, query: string): Array<[number, number]> | null {
  const q = query.trim();
  if (!q || !target) return null;
  if (!canMaybeMatch(q, target)) return null;
  try {
    return tseSearch(target, q) ?? null;
  } catch {
    return null;
  }
}
