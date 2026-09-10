import { describe, expect, it } from "vitest";
import { buildBranch, needsUpdate, parseBlocklist } from "./generate_index.mjs";

describe("parseBlocklist", () => {
  it("忽略注释、空行与首尾空格", () => {
    expect(parseBlocklist("# 注释\n\no/a  \n  o/b\n")).toEqual(new Set(["o/a", "o/b"]));
  });

  it("空文件返回空集合", () => {
    expect(parseBlocklist("")).toEqual(new Set());
  });
});

describe("needsUpdate", () => {
  it("完全一致则无需更新", () => {
    expect(needsUpdate({ main: "aaa" }, { main: "aaa" })).toBe(false);
  });

  it("sha 变化、分支增减、首次记录都要更新", () => {
    expect(needsUpdate({ main: "aaa" }, { main: "bbb" })).toBe(true);
    expect(needsUpdate({ main: "aaa" }, { main: "aaa", dev: "ccc" })).toBe(true);
    expect(needsUpdate(undefined, { main: "aaa" })).toBe(true);
  });
});

describe("buildBranch", () => {
  it("blob 进 files、tree 进目录，路径加 ./ 前缀", () => {
    const branch = buildBranch("main", [
      { path: "src/a.ts", type: "blob", size: 10 },
      { path: "src", type: "tree" },
      { path: "", type: "blob", size: 1 },
    ]);
    expect(branch).toEqual({
      branch_name: "main",
      files: [{ name: "a.ts", path: "./src/a.ts", size: 10 }],
      directories: [{ name: "src", path: "./src" }],
    });
  });

  it("size 缺失默认 0", () => {
    const branch = buildBranch("main", [{ path: "a", type: "blob" }]);
    expect(branch.files[0].size).toBe(0);
  });
});
