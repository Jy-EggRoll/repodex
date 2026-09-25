import { describe, expect, it } from "vitest";
import type { SearchResult } from "../types";
import { pagingSource, type PagingState, type SubmittedSearch } from "./paging";

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
