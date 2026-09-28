/**
 * Index chunk payload convention shared by the Node generator (scripts/generate_index.mjs) and the demo
 * data source (src/client/demo-search.ts): path normalisation, the compact tuple encoding, and the
 * per-branch slicing. Both writers must stay in step with the reader, `decodeChunk` in src/search-core.ts.
 */

/** Items per chunk. A branch never spans two chunks, so every chunk belongs to exactly one branch. */
export const CHUNK_ITEMS = 20000;

/** One entry before encoding: files carry a size, directories do not. */
export interface ChunkItem {
  type: "file" | "directory";
  path: string;
  size?: number;
}

/** Encoded tuple: `[0, path, size]` for files, `[1, path]` (no size) for directories. */
export type ChunkEntry = [0, string, number] | [1, string];

/** One branch's items, as the GitHub tree adapter and the demo corpus both produce them. */
export interface BranchItems {
  branch: string;
  items?: readonly ChunkItem[] | null;
}

/** A chunk-sized slice of one branch: what a single KV key holds. */
export interface ChunkSegment {
  branch: string;
  items: ChunkItem[];
}

/** Paths are stored without a leading "./" or "/" (readers re-derive names from the path). */
export function stripDotSlash(p: string | null | undefined): string {
  return String(p ?? "")
    .replace(/^\.\//, "")
    .replace(/^\//, "");
}

/** Compact chunk payload: [[t, path, size], ...] with t=0 file / t=1 directory; directories omit size. */
export function encodeChunk(items: readonly ChunkItem[]): ChunkEntry[] {
  return items.map((item) =>
    item.type === "directory" ? [1, stripDotSlash(item.path)] : [0, stripDotSlash(item.path), item.size ?? 0],
  );
}

/** One branch's items sliced at the item cap, in order; an empty branch yields no slices. */
export function chunkItems(items: readonly ChunkItem[] | null | undefined): ChunkItem[][] {
  const source = items ?? [];
  const slices: ChunkItem[][] = [];
  for (let i = 0; i < source.length; i += CHUNK_ITEMS) slices.push(source.slice(i, i + CHUNK_ITEMS));
  return slices;
}

/** Flatten branches into chunk-sized `{ branch, items }` segments, preserving branch order and labels. */
export function chunkBranchItems(branches: readonly BranchItems[] | null | undefined): ChunkSegment[] {
  const segments: ChunkSegment[] = [];
  for (const branch of branches ?? []) {
    for (const items of chunkItems(branch.items)) segments.push({ branch: branch.branch, items });
  }
  return segments;
}
