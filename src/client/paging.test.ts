import { describe, expect, it } from "vitest";
import { pagingSource, type PagingState, type SubmittedSearch } from "./paging";

const submitted: SubmittedSearch = { q: "readme", file: "all", mode: "path", count: 100 };

function state(overrides: Partial<PagingState> = {}): PagingState {
  return { submitted, loaded: 100, total: 350, busy: false, error: "", ...overrides };
}

describe("pagingSource", () => {
  it("continues the submitted search while more matches remain", () => {
    expect(pagingSource(state())).toEqual(submitted);
  });

  it("does not page before a search produced a list", () => {
    expect(pagingSource(state({ submitted: null, loaded: 0, total: 0 }))).toBeNull();
  });

  it("does not page while a request is already in flight", () => {
    expect(pagingSource(state({ busy: true }))).toBeNull();
  });

  it("does not page while an error is standing, so a failed page is not re-fired", () => {
    expect(pagingSource(state({ error: "Search failed (500)" }))).toBeNull();
  });

  it("does not page a list that a different search produced", () => {
    // The list on screen holds items of an earlier query: the counts disagree, so paging waits.
    expect(pagingSource(state({ loaded: 250 }))).toBeNull();
    expect(pagingSource(state({ submitted: { ...submitted, count: 40 }, loaded: 100 }))).toBeNull();
  });

  it("does not page past the last match", () => {
    expect(pagingSource(state({ loaded: 350, total: 350 }))).toBeNull();
    expect(
      pagingSource(state({ submitted: { ...submitted, count: 400 }, loaded: 400, total: 350 })),
    ).toBeNull();
  });

  it("carries the request the next page must be fetched with", () => {
    const source = pagingSource(
      state({
        submitted: { q: "文档", file: "owner/repo,owner/other", mode: "name", count: 40 },
        loaded: 40,
      }),
    );
    expect(source).toEqual({ q: "文档", file: "owner/repo,owner/other", mode: "name", count: 40 });
  });
});
