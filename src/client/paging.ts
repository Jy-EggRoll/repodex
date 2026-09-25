/**
 * Paging rules for the result list, kept free of React so they can be unit-tested directly.
 *
 * The rules all answer one question: does the list on screen belong to the search a next page may
 * continue? Auto-paging used to read the live input box and the live index selection, so a keyword
 * typed but never submitted could be paged into the list of an earlier search; and a failed page
 * request left the scroll trigger armed, so the same request re-fired on every observer callback.
 */

import type { SearchResult } from "../types";

/** The request a search actually ran with: the keyword plus the selection it was submitted with. */
export interface SearchRequest {
  q: string;
  /** Index selection sent as the `file` parameter: "all", or a comma-separated list of owner/repo names. */
  file: string;
  mode: "path" | "name";
}

/**
 * A submitted search plus the exact list it produced. Holding the array itself (not its length) is
 * what binds paging to the list on screen: while another result set is being swapped in, the list
 * still holds the previous array, so identity differs and paging waits instead of requesting a page
 * for the wrong list. A length would not do — every full first page has the same length.
 */
export interface SubmittedSearch extends SearchRequest {
  results: SearchResult[];
}

/** Everything the next-page decision reads at the moment it is made. */
export interface PagingState {
  /** The search that produced the list on screen; null before the first successful search. */
  submitted: SubmittedSearch | null;
  /** The list currently on screen. */
  results: SearchResult[] | null;
  /** Total matches reported with that list. */
  total: number;
  /** A request is already in flight (searching, or loading another page). */
  busy: boolean;
  /** Standing error message. Paging after a failure would re-fire the same failing request forever. */
  error: string;
}

/**
 * The submitted search the next page may continue from, or null when no page may be requested.
 * Returning the source rather than a boolean keeps the query, the selection and the offset (the
 * length of `results`) consistent by construction.
 */
export function pagingSource(state: PagingState): SubmittedSearch | null {
  const { submitted, results, total, busy, error } = state;
  if (!submitted || !results || busy || error) return null;
  if (submitted.results !== results) return null;
  if (results.length >= total) return null;
  return submitted;
}
