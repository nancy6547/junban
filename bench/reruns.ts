// Baseline for the benchmark: how many plain reruns (`--repeat-each`) does it
// take before each flaky test fails even once? Stops at the first failure.
//   npx tsx bench/reruns.ts [maxRuns]
import { spawnSync } from "node:child_process";
import fs from "node:fs";

const MAX = Number(process.argv[2] ?? 300);
const titles = [
  "cart shows the total in rupees",
  "search shows results for the full query",
  "products show the sale badge",
  "price shows the live price",
  "orders greet the signed-in user",
  "recommendations use the dark theme",
];
const out: Record<string, { runs: number; failed: boolean; ms: number }> = {};
for (const title of titles) {
  const t0 = Date.now();
  const r = spawnSync("npx", ["playwright", "test", "demo/tests/shop.spec.ts", "-g", title, "--repeat-each", String(MAX),
    "--max-failures", "1", "--workers", "4", "--retries", "0", "--reporter", "json"], { encoding: "utf8", maxBuffer: 256 << 20 });
  const json = JSON.parse(r.stdout.slice(r.stdout.indexOf("{")));
  let runs = 0, failed = false;
  const walk = (s: any) => {
    for (const sp of s.specs ?? []) for (const t of sp.tests) for (const res of t.results) {
      if (res.status === "skipped") continue;
      runs++;
      if (res.status !== "passed") failed = true;
    }
    for (const x of s.suites ?? []) walk(x);
  };
  for (const s of json.suites) walk(s);
  out[title] = { runs, failed, ms: Date.now() - t0 };
  console.log(`${failed ? "failed after" : "never failed in"} ${runs} runs (${((Date.now() - t0) / 1000).toFixed(0)}s)  ${title}`);
  fs.writeFileSync(process.env.OUT ?? "bench/reruns.json", JSON.stringify(out, null, 2));
}
