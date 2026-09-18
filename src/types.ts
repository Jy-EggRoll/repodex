/** Wire types shared by the Worker routes, the search core and the client. */
import type { RepoRisk } from "./risk";

export interface RepoInfo {
  full_name: string;
  size: number;
  size_mb: number;
  risk: RepoRisk;
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
  highlightedPath?: string;
  highlightedName?: string;
}
