import { describe, expect, it } from "vitest";
import { leavingKeys } from "./hooks";

describe("leavingKeys", () => {
  it("returns keys missing from the next list, in previous order", () => {
    expect(leavingKeys(["a", "b", "c"], ["c", "a"])).toEqual(["b"]);
  });

  it("returns nothing when items only stay or appear", () => {
    expect(leavingKeys(["a", "b"], ["a", "b"])).toEqual([]);
    expect(leavingKeys(["a"], ["a", "b"])).toEqual([]);
  });

  it("returns everything when the next list is empty", () => {
    expect(leavingKeys(["a", "b"], [])).toEqual(["a", "b"]);
  });
});
