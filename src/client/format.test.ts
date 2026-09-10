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
  it("优先使用 size_mb", () => {
    expect(formatRepoSize(repo(819200, 800))).toBe("800 MB");
  });

  it("size_mb 非法时回退到 KB 换算", () => {
    expect(formatRepoSize(repo(2048, NaN))).toBe("2.00 MB");
  });
});

describe("formatFileSize", () => {
  it("bytes 换算", () => {
    expect(formatFileSize(item(1048576))).toBe("1 MB");
  });

  it("size 缺失时用 size_mb", () => {
    expect(formatFileSize(item(undefined, 2.5))).toBe("2.5 MB");
  });

  it("都没有则显示占位", () => {
    expect(formatFileSize(item())).toBe("-");
  });
});

describe("buildFileParam", () => {
  it("未选或全选都走 all", () => {
    expect(buildFileParam([], 3)).toBe("all");
    expect(buildFileParam(["a", "b", "c"], 3)).toBe("all");
  });

  it("部分选中则逗号拼接", () => {
    expect(buildFileParam(["a-index", "c-index"], 3)).toBe("a-index,c-index");
  });
});
