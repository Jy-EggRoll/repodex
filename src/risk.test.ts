import { describe, expect, it } from "vitest";
import { riskForSize } from "./risk";

describe("riskForSize", () => {
  it("800 以下安全", () => {
    expect(riskForSize(799.99)).toBe("safe");
  });

  it("800~900 警告", () => {
    expect(riskForSize(800)).toBe("warn");
    expect(riskForSize(900)).toBe("warn");
  });

  it("900 以上危险", () => {
    expect(riskForSize(900.01)).toBe("danger");
  });
});
