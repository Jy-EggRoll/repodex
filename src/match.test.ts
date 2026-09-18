import { describe, expect, it } from "vitest";
import { search as tseSearch } from "text-search-engine";
import { canMaybeMatch, matchRanges } from "./match";

describe("canMaybeMatch soundness", () => {
  const pairs: Array<[string, string]> = [
    ["readme", "README.md"],
    ["rsp", "src/README.md"],
    ["zzz", "src/index.ts"],
    ["SM", "说明.md"],
    ["sm", "说明文档.md"],
    ["拼音", "说明文档.md"],
    ["a b", "docs/a  b.txt"],
    ["a b", "docs/a b.txt"],
    ["a\u00a0b", "docs/a b.txt"],
    ["md", "说明.md"],
    ["全角", "ｆｕｌｌｗｉｄｔｈ.txt"],
    ["TM", "README.md"],
  ];

  it("a negative prefilter verdict always means the library finds nothing", () => {
    for (const [q, t] of pairs) {
      if (!canMaybeMatch(q, t)) {
        expect(tseSearch(t, q), `q=${q} target=${t}`).toBeUndefined();
      }
    }
  });

  it("defers to the library for non-ASCII targets (pinyin/space semantics)", () => {
    expect(canMaybeMatch("SM", "说明.md")).toBe(true);
    expect(canMaybeMatch("a b", "docs/a  b.txt")).toBe(true);
    expect(canMaybeMatch("md", "说明.md")).toBe(true);
  });

  it("plain ASCII still gets the fast path", () => {
    expect(canMaybeMatch("zzz", "src/index.ts")).toBe(false);
    expect(canMaybeMatch("readme", "README.md")).toBe(true);
  });
});

describe("matchRanges", () => {
  it("returns exactly the ranges the library produces", () => {
    expect(matchRanges("README.md", "read")).toEqual(tseSearch("README.md", "read"));
    expect(matchRanges("owner/some-repo", "some")).toEqual(tseSearch("owner/some-repo", "some"));
  });

  it("returns null for empty queries, empty targets and non-matches", () => {
    expect(matchRanges("README.md", "")).toBeNull();
    expect(matchRanges("README.md", "   ")).toBeNull();
    expect(matchRanges("", "read")).toBeNull();
    expect(matchRanges("src/index.ts", "zzz")).toBeNull();
  });
});
