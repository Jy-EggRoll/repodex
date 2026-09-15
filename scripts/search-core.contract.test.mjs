import { describe, expect, it } from "vitest";
import { buildBranch, buildChunkWrites } from "./generate_index.mjs";
import { decodeChunk, parseLegacyIndex } from "../src/search-core.ts";

// Producer/consumer contract: whatever the generator writes as chunks must read back exactly like the
// legacy envelope the Worker has always parsed (same order, same derived names, same sizes).

const TREE = [
  { path: "src", type: "tree" },
  { path: "src/a.ts", type: "blob", size: 120 },
  { path: "README.md", type: "blob", size: 40 },
  { path: "assets", type: "tree" },
  { path: "assets/logo.png", type: "blob", size: 9000 },
];

describe("generate_index -> search-core contract", () => {
  it("chunks decode to exactly what the legacy envelope parses to", () => {
    const branchesData = [
      buildBranch("dev", [{ path: "说明.md", type: "blob", size: 0 }]),
      buildBranch("main", TREE),
    ];
    const envelope = { repository: "o/r", repository_short_name: "r", branches: branchesData };
    const legacy = parseLegacyIndex(envelope);

    const { chunks, repo } = buildChunkWrites({ fullName: "o/r", shortName: "r" }, branchesData);
    const decoded = chunks.flatMap((c) => decodeChunk(JSON.stringify(c.value), "o/r", c.branch));

    expect(decoded).toEqual(legacy);
    expect(repo).toEqual({ r: "o/r", rs: "r", n: legacy.length });
    expect(chunks.reduce((sum, c) => sum + c.n, 0)).toBe(legacy.length);
  });

  it("directory tuples derive the same name as the envelope and keep size undefined", () => {
    const branchesData = [buildBranch("main", TREE)];
    const legacy = parseLegacyIndex({ repository: "o/r", branches: branchesData });
    const { chunks } = buildChunkWrites({ fullName: "o/r", shortName: "r" }, branchesData);
    const decoded = chunks.flatMap((c) => decodeChunk(JSON.stringify(c.value), "o/r", c.branch));

    const legacyDirs = legacy.filter((e) => e.type === "directory");
    const decodedDirs = decoded.filter((e) => e.type === "directory");
    expect(decodedDirs).toEqual(legacyDirs);
    expect(decodedDirs.every((d) => d.size === undefined)).toBe(true);
  });
});
