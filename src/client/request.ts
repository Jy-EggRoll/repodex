/**
 * Request discipline for the search screen, kept free of React so it can be unit-tested directly.
 *
 * Every search and every "next page" is one request, and only the newest one may touch the screen.
 * That rule used to be written out at each call site; here it is written once, so the first page and
 * the next page cannot drift apart.
 */

import { ApiError } from "./api";

/**
 * Monotonic request gate: a request takes a token and may only apply its outcome while that token is
 * still the newest. One gate serves the whole screen, so a slow page of an earlier search can never
 * land after a newer search started.
 */
export interface RequestGate {
  /** Start a request: returns its token and makes it the newest. */
  begin(): number;
  /** Whether `token` is still the newest, i.e. whether its outcome may be applied. */
  isCurrent(token: number): boolean;
}

export function createRequestGate(): RequestGate {
  let newest = 0;
  return {
    begin: () => ++newest,
    isCurrent: (token) => token === newest,
  };
}

/** What the UI shows for a failed request; `status` is null when the failure carried no HTTP status. */
export interface RequestFailure {
  status: number | null;
  message: string;
}

export function requestFailure(e: unknown): RequestFailure {
  return {
    status: e instanceof ApiError ? e.status : null,
    message: e instanceof Error ? e.message : String(e),
  };
}

/**
 * Run one request and apply its outcome only while it is still the newest. `onSuccess`, `onFailure`
 * and `onSettled` are all gated, so a superseded request leaves no trace: no stale results, no stale
 * error, no stuck spinner. `onSettled` is what a caller uses to clear its own in-flight flag.
 */
export async function runLatest<T>(
  gate: RequestGate,
  request: () => Promise<T>,
  onSuccess: (value: T) => void,
  onFailure: (failure: RequestFailure) => void,
  onSettled: () => void,
): Promise<void> {
  const token = gate.begin();
  try {
    const value = await request();
    if (gate.isCurrent(token)) onSuccess(value);
  } catch (e) {
    if (gate.isCurrent(token)) onFailure(requestFailure(e));
  } finally {
    if (gate.isCurrent(token)) onSettled();
  }
}
