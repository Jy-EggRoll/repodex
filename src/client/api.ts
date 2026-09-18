import { t } from "./i18n";
import type { RepoInfo, SearchResult } from "../types";

// Demo build switch: VITE_DEMO=1 serves locally synthesized data (dynamically imported, zero residue in production bundles)
export const DEMO = import.meta.env.VITE_DEMO === "1";

/** Read the server error code (if any) and translate it; falls back to a generic message. */
async function errorMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error ? t(body.error) : t("Request failed ({0})", { 0: res.status });
}

export async function fetchRepos(): Promise<RepoInfo[]> {
  if (DEMO) return (await import("./demo-search")).listRepos();
  const res = await fetch("/api/get-repo-info");
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.json();
}

export async function fetchIndexList(): Promise<string[]> {
  if (DEMO) return (await import("./demo-search")).listIndexes();
  const res = await fetch("/api/repo-list");
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.json();
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface SearchResponse {
  results: SearchResult[];
  total: number;
  truncated: boolean;
  fileCount: number;
  dirCount: number;
  indexCount: number;
  itemsTotal: number;
  loadFailCount: number;
  tookMs: number;
  loadMs: number;
  searchMs: number;
}

export interface SearchPerf extends SearchResponse {
  roundTripMs: number;
}

/** Turn the selected indexes into the `file` query param: no selection or full selection both mean "all". */
export function buildFileParam(checked: string[], total: number): string {
  return checked.length > 0 && checked.length !== total ? checked.join(",") : "all";
}

export async function searchFiles(
  q: string,
  fileParam: string,
  mode: "path" | "name",
  limit = 100,
  offset = 0,
): Promise<SearchResponse> {
  if (DEMO) return (await import("./demo-search")).searchIndexes(q, fileParam, mode, limit, offset);
  const res = await fetch(
    `/api/search?q=${encodeURIComponent(q)}&file=${encodeURIComponent(fileParam)}&mode=${mode}&limit=${limit}&offset=${offset}`,
  );
  if (!res.ok) throw new ApiError(res.status, await errorMessage(res));
  return res.json();
}
