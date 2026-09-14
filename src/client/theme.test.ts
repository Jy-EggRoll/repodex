import { describe, expect, it } from "vitest";
import { resolveMode } from "./theme";

describe("resolveMode", () => {
  it("manual value takes precedence over system", () => {
    expect(resolveMode("light", true)).toBe("light");
    expect(resolveMode("dark", false)).toBe("dark");
  });

  it("auto follows the system", () => {
    expect(resolveMode("auto", true)).toBe("dark");
    expect(resolveMode("auto", false)).toBe("light");
  });

  it("defaults to following the system when nothing is stored", () => {
    expect(resolveMode(null, true)).toBe("dark");
    expect(resolveMode(null, false)).toBe("light");
  });
});
