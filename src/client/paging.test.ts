import { describe, expect, it } from "vitest";
import type { SearchResult } from "../types";
import {
  pagingSource,
  resultsExhausted,
  totalAfterPage,
  truncationNoticeVisible,
  type PagingState,
  type SubmittedSearch,
} from "./paging";

function item(name: string): SearchResult {
  return {
    name,
    repository: "owner/repo",
    branch: "main",
    path: name,
    size: 1,
    size_mb: 0,
    type: "file",
    github_url: undefined,
  };
}

/** The list the submitted search produced: the identity paging is bound to. */
const list = [item("a.md"), item("b.md")];
const submitted: SubmittedSearch = { q: "readme", file: "all", mode: "path", results: list };

function state(overrides: Partial<PagingState> = {}): PagingState {
  return { submitted, results: list, total: 350, busy: false, error: "", ...overrides };
}

describe("pagingSource", () => {
  it("continues the submitted search while more matches remain", () => {
    expect(pagingSource(state())).toEqual(submitted);
  });

  it("does not page before a search produced a list", () => {
    expect(pagingSource(state({ submitted: null, results: null, total: 0 }))).toBeNull();
  });

  it("does not page while a request is already in flight", () => {
    expect(pagingSource(state({ busy: true }))).toBeNull();
  });

  it("does not page while an error is standing, so a failed page is not re-fired", () => {
    expect(pagingSource(state({ error: "Search failed (500)" }))).toBeNull();
  });

  it("does not page a list that a different search produced", () => {
    // Same length as the submitted list: a length check would let this through, identity does not.
    expect(pagingSource(state({ results: [item("x.md"), item("y.md")] }))).toBeNull();
    expect(pagingSource(state({ results: [item("z.md")] }))).toBeNull();
  });

  it("does not page past the last match", () => {
    expect(pagingSource(state({ total: 2 }))).toBeNull();
    expect(pagingSource(state({ total: 0 }))).toBeNull();
  });

  it("carries the request the next page must be fetched with", () => {
    const source = pagingSource(
      state({
        submitted: { q: "文档", file: "owner/repo,owner/other", mode: "name", results: list },
      }),
    );
    expect(source).toEqual({
      q: "文档",
      file: "owner/repo,owner/other",
      mode: "name",
      results: list,
    });
  });

  it("keeps paging once a page was appended, and waits until the longer list is on screen", () => {
    const grown = [...list, item("c.md")];
    const grownSearch: SubmittedSearch = { ...submitted, results: grown };
    expect(pagingSource(state({ submitted: grownSearch, results: grown, total: 350 }))).toEqual(grownSearch);
    expect(pagingSource(state({ submitted: grownSearch, results: list }))).toBeNull();
  });
});

describe("totalAfterPage", () => {
  it("takes the total the page reported", () => {
    expect(totalAfterPage({ results: [item("c.md")], total: 350 }, 3)).toBe(350);
  });

  it("never reports fewer matches than the list already shows", () => {
    // An index rebuild mid-scroll can report fewer matches than are on screen
    expect(totalAfterPage({ results: [item("c.md")], total: 2 }, 3)).toBe(3);
  });

  it("treats an empty page as the end of the list, whatever total it came with", () => {
    // The storm case: the offset is past the matches that still exist, so the page is empty while a
    // stale total claims more. The total must fall to the list length, or paging never stops.
    expect(totalAfterPage({ results: [], total: 1000 }, 3)).toBe(3);
  });

  it("stops paging after that empty page instead of re-firing the same offset", () => {
    const grown = [...list, item("c.md")];
    const grownSearch: SubmittedSearch = { ...submitted, results: grown };
    const total = totalAfterPage({ results: [], total: 350 }, grown.length);
    expect(pagingSource(state({ submitted: grownSearch, results: grown, total }))).toBeNull();
  });
});

describe("resultsExhausted", () => {
  it("is false before any list exists and while matches remain", () => {
    expect(resultsExhausted(null, 0)).toBe(false);
    expect(resultsExhausted(null, 350)).toBe(false);
    expect(resultsExhausted(list, 350)).toBe(false);
  });

  it("is true once the list holds as many items as the reported total", () => {
    expect(resultsExhausted(list, 2)).toBe(true);
    expect(resultsExhausted(list, 0)).toBe(true);
  });
});

describe("truncationNoticeVisible", () => {
  it("shows only for a truncated search whose list has reached the cap", () => {
    expect(truncationNoticeVisible({ results: list, total: 2, truncated: true })).toBe(true);
  });

  it("stays hidden while the capped list can still load more pages", () => {
    expect(truncationNoticeVisible({ results: list, total: 1000, truncated: true })).toBe(false);
  });

  it("stays hidden for a complete, untruncated result set", () => {
    expect(truncationNoticeVisible({ results: list, total: 2, truncated: false })).toBe(false);
  });

  it("stays hidden before any list exists", () => {
    expect(truncationNoticeVisible({ results: null, total: 0, truncated: true })).toBe(false);
  });
});
