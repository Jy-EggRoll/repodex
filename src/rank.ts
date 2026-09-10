/** 排名键：全部从匹配库返回的 ranges 直接导出，零新增匹配成本。 */
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
 * 字典序排名（无权重、无魔法数）：
 * 覆盖率降序 → 首命中位置升序 → 区间数升序 → 目标长度升序。
 */
export function compareRank(a: RankKey, b: RankKey): number {
  const covA = a.matched / a.targetLen;
  const covB = b.matched / b.targetLen;
  if (covA !== covB) return covB - covA;
  if (a.firstPos !== b.firstPos) return a.firstPos - b.firstPos;
  if (a.spans !== b.spans) return a.spans - b.spans;
  return a.targetLen - b.targetLen;
}
