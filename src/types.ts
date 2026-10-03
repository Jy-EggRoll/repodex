/** Wire types shared by the Worker routes, the search core and the client. */
import type { RepoRisk } from "./risk";

/**
 * Every code the server may put in the `error` field of a failed response.
 *
 * These strings are also l10n keys: the client translates whatever arrives in `error` verbatim
 * (see `translateError` in src/client/api.ts), so each code here must exist in every bundle under
 * /l10n. Nothing else keeps the two sides of the wire contract in sync — the source scan in
 * src/client/i18n.test.ts only sees literal `t("...")` calls and is blind to `t(body.error)` — so
 * that test additionally walks this map and fails when a code has no translation.
 */
export const ERROR_CODES = {
  emptyQuery: "empty query",
  invalidFile: "invalid file",
  notFound: "not found",
  indexNotReady: "index not ready, run Central Repository Index workflow first",
  kvUnavailable: "repo_index_kv binding is not available",
  // For unhandled exceptions: the real message goes to the server log (console.error), never to the
  // client. Sending `String(err)` instead would leak internals into the UI and hand the client a
  // string that no bundle can translate.
  internalError: "internal error",
} as const;

/** A translatable error code; narrows what the server is allowed to send to the client. */
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

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
