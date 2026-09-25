/**
 * Paging rules for the result list, kept free of React so they can be unit-tested directly.
 *
 * Two defects live here, both about *which* list a "next page" belongs to:
 * auto-paging used to read the live input box and the live index selection, so a keyword typed but
 * never submitted could be paged into the list of an earlier search; and a failed page request left
 * the scroll trigger armed, so the same request re-fired on every observer callback.
 */

/** The request a search actually ran with: the keyword plus the selection it was submitted with. */
export interface SearchRequest {
  q: string;
  /** Index selection sent as the `file` parameter: "all", or a comma-separated list of owner/repo names. */
  file: string;
  mode: "path" | "name";
}

/**
 * A submitted search plus the size of the list it produced. That count binds paging to the list on
 * screen: while another result set is being swapped in, the list still holds the previous items, so
 * the counts differ and paging waits instead of requesting a page for the wrong list.
 */
export interface SubmittedSearch extends SearchRequest {
  count: number;
}

/** Everything the next-page decision reads at the moment it is made. */
export interface PagingState {
  /** The search that produced the list on screen; null before the first successful search. */
  submitted: SubmittedSearch | null;
  /** Items currently in the list. */
  loaded: number;
  /** Total matches reported with that list. */
  total: number;
  /** A request is already in flight (searching, or loading another page). */
  busy: boolean;
  /** Standing error message. Paging after a failure would re-fire the same failing request forever. */
  error: string;
}

/**
 * The submitted search the next page may continue from, or null when no page may be requested.
 * Returning the source rather than a boolean keeps the query, the selection and the offset (its
 * `count`) consistent by construction.
 */
export function pagingSource(state: PagingState): SubmittedSearch | null {
  const { submitted, loaded, total, busy, error } = state;
  if (!submitted || busy || error) return null;
  if (submitted.count !== loaded) return null;
  if (loaded >= total) return null;
  return submitted;
}
