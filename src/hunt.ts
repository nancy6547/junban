// The hunt: find an order of network responses that breaks a test, then
// shrink it to the smallest rule that still breaks it.
//
//   1. record   run the test normally a few times; keep a passing order
//   2. explore  try every "move one response earlier" order, then random ones
//   3. shrink   delta-debug the flipped pairs down to a minimal rule set
//   4. confirm  re-run the final order several times; it must always fail

import { runSchedules, runCounter, type RunOptions } from "./runner.js";
import { applyRules, ddmin, inversions, pairSwaps, shuffles, type Rule } from "./order.js";
import type { RunResult } from "./fixture.js";

export interface HuntOptions extends RunOptions {
  budget?: number; // max orderings to explore
  seed?: number;
  confirmRuns?: number;
  log?: (msg: string) => void;
}

export interface HuntReport {
  test: string;
  file: string;
  verdict: "race-found" | "no-race-found" | "fails-without-reordering";
  baseline?: RunResult; // a passing run (record mode)
  failing?: RunResult; // a run under the minimal failing order
  rules: Rule[];
  minimalOrder?: string[];
  explored: number;
  /** runs until the first failure (recording + exploring, in order) */
  runsToFailure?: number;
  /** all runs, including shrinking and the confirmation runs */
  totalRuns: number;
  confirm?: { failed: number; runs: number };
  ms: number;
}

export async function hunt(opts: HuntOptions): Promise<HuntReport> {
  const log = opts.log ?? (() => {});
  const t0 = Date.now();
  runCounter.reset();
  const base: Omit<HuntReport, "verdict"> = { test: opts.title, file: opts.file, rules: [], explored: 0, totalRuns: 0, ms: 0 };
  const finish = (r: HuntReport): HuntReport => ({ ...r, totalRuns: runCounter.get(), ms: Date.now() - t0 });

  // 1. record
  log("recording a passing run...");
  const rec = await runSchedules(opts, [null, null, null]);
  const pass = rec.results.find((r) => r.status === "passed");
  if (!pass) {
    log("the test fails even without reordering; this is not a network-order flake");
    return finish({ ...base, verdict: "fails-without-reordering", failing: rec.results[0] });
  }
  const O = pass.releaseOrder;
  log(`baseline order (${O.length} requests): ${O.join("  →  ")}`);
  if (O.length < 2) return finish({ ...base, verdict: "no-race-found", baseline: pass });

  // 2. explore: pair swaps first (most races involve two requests), then random
  const budget = opts.budget ?? 60;
  const swaps = pairSwaps(O).slice(0, budget);
  log(`trying ${swaps.length} pair swaps...`);
  let batch = await runSchedules(opts, swaps);
  let explored = swaps.length;
  let failing = batch.results.find((r) => r.status === "failed");
  let runsToFailure = failing ? rec.results.length + failing.index + 1 : undefined;
  if (!failing && budget > swaps.length) {
    const skip = new Set(swaps.map((s) => s.join("|")));
    const randoms = shuffles(O, budget - swaps.length, opts.seed ?? 1, skip);
    if (randoms.length) {
      log(`no failure yet; trying ${randoms.length} random orders (seed ${opts.seed ?? 1})...`);
      batch = await runSchedules(opts, randoms);
      explored += randoms.length;
      failing = batch.results.find((r) => r.status === "failed");
      if (failing) runsToFailure = rec.results.length + swaps.length + failing.index + 1;
    }
  }
  if (!failing) {
    log(`no failing order in ${explored} tries`);
    return finish({ ...base, verdict: "no-race-found", baseline: pass, explored });
  }
  log(`found a failing order on run ${runsToFailure}: ${failing.releaseOrder.join("  →  ")}`);

  // 3. shrink: which flipped pairs actually matter?
  const flipped = inversions(O, failing.releaseOrder);
  log(`shrinking ${flipped.length} flipped pair(s)...`);
  const cache = new Map<string, boolean>();
  const rules = await ddmin(flipped, async (subsets) => {
    const orders = subsets.map((s) => applyRules(O, s));
    const todo = orders.map((o, i) => ({ o, i })).filter((x) => x.o && !cache.has(x.o.join("|")));
    if (todo.length) {
      const res = await runSchedules(opts, todo.map((x) => x.o!));
      todo.forEach((x, k) => cache.set(x.o!.join("|"), res.results[k]?.status === "failed"));
    }
    return orders.map((o) => (o ? cache.get(o.join("|")) ?? false : false));
  });
  const minimalOrder = applyRules(O, rules)!;

  // 4. confirm
  const n = opts.confirmRuns ?? 5;
  const conf = await runSchedules(opts, Array(n).fill(minimalOrder));
  const failed = conf.results.filter((r) => r.status === "failed").length;
  log(`minimal rule: ${rules.map(([a, b]) => `${a} before ${b}`).join(" AND ")}  (fails ${failed}/${n})`);
  return finish({
    ...base,
    verdict: "race-found",
    baseline: pass,
    failing: conf.results.find((r) => r.status === "failed") ?? failing,
    rules,
    minimalOrder,
    explored,
    runsToFailure,
    confirm: { failed, runs: n },
  });
}
