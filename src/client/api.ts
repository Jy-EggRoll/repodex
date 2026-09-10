export interface RepoInfo {
  name: string;
  size: number;
  size_mb: number;
  risk: "safe" | "warn" | "danger";
  description: string | null;
  html_url: string;
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
  ranges: [number, number][];
  score: number;
  highlightedPath?: string;
  highlightedName?: string;
}

export async function fetchRepos(): Promise<RepoInfo[]> {
  const res = await fetch("/api/get-repo-info");
  if (!res.ok) throw new Error("接口请求失败，请检查权限或网络状态");
  return res.json();
}

export async function fetchIndexList(): Promise<string[]> {
  const res = await fetch("/api/repo-list");
  if (!res.ok) throw new Error(`请求失败 ${res.status}`);
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
}

/** 选中索引转 file 查询参数：全选或未选都走 all。 */
export function buildFileParam(checked: string[], total: number): string {
  return checked.length > 0 && checked.length !== total ? checked.join(",") : "all";
}

export async function searchFiles(
  q: string,
  fileParam: string,
  mode: "path" | "name",
): Promise<SearchResponse> {
  const res = await fetch(
    `/api/search?q=${encodeURIComponent(q)}&file=${encodeURIComponent(fileParam)}&mode=${mode}`,
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string };
    throw new ApiError(res.status, body.error || `请求失败 ${res.status}`);
  }
  return res.json();
}
