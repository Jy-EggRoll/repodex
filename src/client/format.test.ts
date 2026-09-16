import { describe, expect, it } from "vitest";
import { buildFileParam, type RepoInfo, type SearchResult } from "./api";
import { formatFileSize, formatRepoSize } from "./format";

const repo = (size: number, size_mb: number): RepoInfo => ({
  name: "r",
  size,
  size_mb,
  risk: "safe",
  description: null,
  html_url: "https://example.com",
});

const item = (size?: number, size_mb?: number): SearchResult => ({
  name: "f",
  repository: "o/r",
  branch: "main",
  path: "f",
  size,
  size_mb: size_mb ?? NaN,
  type: "file",
  github_url: undefined,
  ranges: [],
  score: 0,
});

describe("formatRepoSize", () => {
  it("prefers size_mb", () => {
    expect(formatRepoSize(repo(819200, 800))).toBe("800 MB");
  });

  it("falls back to KB conversion when size_mb is invalid", () => {
    expect(formatRepoSize(repo(2048, NaN))).toBe("2.00 MB");
  });
});

describe("formatFileSize", () => {
  it("converts bytes", () => {
    expect(formatFileSize(item(1048576))).toBe("1 MB");
  });

  it("uses size_mb when size is missing", () => {
    expect(formatFileSize(item(undefined, 2.5))).toBe("2.5 MB");
  });

  it("shows a placeholder when both are missing", () => {
    expect(formatFileSize(item())).toBe("-");
  });
});

describe("buildFileParam", () => {
  it("no selection or full selection both mean all", () => {
    expect(buildFileParam([], 3)).toBe("all");
    expect(buildFileParam(["a", "b", "c"], 3)).toBe("all");
  });

  it("partial selection joins with commas", () => {
    expect(buildFileParam(["owner/a", "owner/c"], 3)).toBe("owner/a,owner/c");
  });
});
