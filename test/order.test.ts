import { describe, it, expect } from "vitest";
import { applyRules, ddmin, inversions, pairSwaps, shuffles } from "../src/order.js";

describe("pairSwaps", () => {
  it("moves each later request in front of each earlier one", () => {
    expect(pairSwaps(["a", "b", "c"])).toEqual([
      ["b", "a", "c"],
      ["c", "a", "b"],
      ["a", "c", "b"],
    ]);
  });
  it("gives n(n-1)/2 orders", () => {
    expect(pairSwaps(["a", "b", "c", "d", "e"]).length).toBe(10);
  });
});

describe("inversions", () => {
  it("lists the pairs that changed order", () => {
    expect(inversions(["a", "b", "c"], ["c", "a", "b"])).toEqual([
      ["c", "a"],
      ["c", "b"],
    ]);
  });
  it("is empty for the same order", () => {
    expect(inversions(["a", "b"], ["a", "b"])).toEqual([]);
  });
});

describe("applyRules", () => {
  it("keeps the baseline order where no rule says otherwise", () => {
    expect(applyRules(["a", "b", "c", "d"], [["d", "b"]])).toEqual(["a", "c", "d", "b"]);
  });
  it("returns null for contradicting rules", () => {
    expect(applyRules(["a", "b"], [["a", "b"], ["b", "a"]])).toBeNull();
  });
  it("rebuilds the failing order from all of its inversions", () => {
    const base = ["a", "b", "c", "d"], bad = ["c", "a", "d", "b"];
    expect(applyRules(base, inversions(base, bad))).toEqual(bad);
  });
});

describe("shuffles", () => {
  it("is repeatable with the same seed and skips known orders", () => {
    const one = shuffles(["a", "b", "c", "d"], 5, 42);
    expect(shuffles(["a", "b", "c", "d"], 5, 42)).toEqual(one);
    expect(one.map((o) => o.join(""))).not.toContain("abcd");
    expect(new Set(one.map((o) => o.join(""))).size).toBe(one.length);
  });
  it("stops when every order has been seen", () => {
    expect(shuffles(["a", "b"], 10, 1).length).toBe(1);
  });
});

describe("ddmin", () => {
  it("finds the single pair that matters", async () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const fails = async (sets: number[][]) => sets.map((s) => s.includes(6));
    expect(await ddmin(items, fails)).toEqual([6]);
  });
  it("finds two items that only fail together", async () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const fails = async (sets: number[][]) => sets.map((s) => s.includes(2) && s.includes(7));
    expect((await ddmin(items, fails)).sort()).toEqual([2, 7]);
  });
});
