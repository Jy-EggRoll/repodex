import { describe, expect, it } from "vitest";
import { staggerDelayMs } from "./ui";

describe("staggerDelayMs", () => {
  it("staggers linearly by index", () => {
    expect(staggerDelayMs(0)).toBe(0);
    expect(staggerDelayMs(3)).toBe(120);
  });

  it("clamps to the max delay past the cap", () => {
    expect(staggerDelayMs(11)).toBe(440);
    expect(staggerDelayMs(99)).toBe(440);
  });
});
