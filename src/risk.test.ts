import { describe, expect, it } from "vitest";
import { riskForSize } from "./risk";

describe("riskForSize", () => {
  it("below 800 MB is safe", () => {
    expect(riskForSize(799.99)).toBe("safe");
  });

  it("800 to 900 MB is warned", () => {
    expect(riskForSize(800)).toBe("warn");
    expect(riskForSize(900)).toBe("warn");
  });

  it("above 900 MB is danger", () => {
    expect(riskForSize(900.01)).toBe("danger");
  });
});
