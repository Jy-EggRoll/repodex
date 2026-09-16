import { describe, expect, it } from "vitest";
import { buildBranchItems, buildChunkWrites } from "./generate_index.mjs";
import { decodeChunk } from "../src/search-core.ts";

// Producer/consumer contract: generator chunk payloads must decode to exactly the entry stream the
// Worker scans — same order, names derived from paths, directory sizes undefined.

const TREE = [
  { path: "src", type: "tree" },
  { path: "src/a.ts", type: "blob", size: 120 },
  { path: "README.md", type: "blob", size: 40 },
  { path: "assets", type: "tree" },
  { path: "assets/logo.png", type: "blob", size: 9000 },
];

describe("generate_index -> search-core contract", () => {
  it("chunks decode to the exact entries, in order, with derived names", () => {
    const branches = [
      buildBranchItems("dev", [{ path: "说明.md", type: "blob", size: 0 }]),
      buildBranchItems("main", TREE),
    ];
    const { chunks, repo } = buildChunkWrites({ fullName: "o/r" }, branches);
    const decoded = chunks.flatMap((c) => decodeChunk(JSON.stringify(c.value), "o/r", c.branch));

    expect(decoded).toEqual([
      { name: "说明.md", repository: "o/r", branch: "dev", path: "说明.md", size: 0, type: "file" },
      { name: "a.ts", repository: "o/r", branch: "main", path: "src/a.ts", size: 120, type: "file" },
      { name: "README.md", repository: "o/r", branch: "main", path: "README.md", size: 40, type: "file" },
      {
        name: "logo.png",
        repository: "o/r",
        branch: "main",
        path: "assets/logo.png",
        size: 9000,
        type: "file",
      },
      { name: "src", repository: "o/r", branch: "main", path: "src", size: undefined, type: "directory" },
      {
        name: "assets",
        repository: "o/r",
        branch: "main",
        path: "assets",
        size: undefined,
        type: "directory",
      },
    ]);
    expect(repo).toEqual({ r: "o/r", n: decoded.length });
    expect(chunks.reduce((sum, c) => sum + c.n, 0)).toBe(decoded.length);
  });

  it("directory tuples derive the name and keep size undefined", () => {
    const branches = [buildBranchItems("main", TREE)];
    const { chunks } = buildChunkWrites({ fullName: "o/r" }, branches);
    const decoded = chunks.flatMap((c) => decodeChunk(JSON.stringify(c.value), "o/r", c.branch));

    expect(decoded.filter((e) => e.type === "directory")).toEqual([
      { name: "src", repository: "o/r", branch: "main", path: "src", size: undefined, type: "directory" },
      {
        name: "assets",
        repository: "o/r",
        branch: "main",
        path: "assets",
        size: undefined,
        type: "directory",
      },
    ]);
  });
});
