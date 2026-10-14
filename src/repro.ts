// Writes a stand-alone Playwright test that forces the bad response order
// with plain `page.route()`. It needs only @playwright/test (not Junban), so
// you can attach it to a GitHub issue and anyone can see the bug every time.

import fs from "node:fs";
import path from "node:path";
import { BASE_KEY_SRC, VOLATILE_PARAMS } from "./key.js";
import type { Rule } from "./order.js";

export interface Race {
  title: string;
  rules: Rule[];
}

export function reproSource(testSource: string, races: Race[]): string {
  // 1. point the import back at plain Playwright
  const src = testSource.replace(
    /from\s+["']([^"']*)["']/g,
    (m, mod: string) => (mod === "junban" || /(^|\/)junban(\/|$)|src\/index(\.js)?$/.test(mod) ? `from "@playwright/test"` : m),
  );

  // 2. insert the order-forcing hook after the last import
  const lines = src.split(/\r?\n/);
  let last = -1;
  lines.forEach((l, i) => {
    if (/^\s*import\s/.test(l)) last = i;
  });
  const hook = `
// ---- added by Junban: forces the response order that breaks each test ----
${races.map((r) => `// "${r.title}" fails when ${r.rules.map(([a, b]) => `${a} arrives before ${b}`).join(" AND ")}`).join("\n")}
const JUNBAN_RACES: Record<string, [string, string][]> = ${JSON.stringify(Object.fromEntries(races.map((r) => [r.title, r.rules])), null, 2)};
const VOLATILE_PARAMS = new Set(${JSON.stringify([...VOLATILE_PARAMS])});
const junbanBaseKey = ${BASE_KEY_SRC};

test.beforeEach(async ({ page }, testInfo) => {
  const rules = JUNBAN_RACES[testInfo.title];
  if (!rules) return;
  const counts = new Map<string, number>();
  const done = new Map<string, { promise: Promise<void>; resolve: () => void }>();
  const gate = (key: string) => {
    if (!done.has(key)) {
      let resolve!: () => void;
      const promise = new Promise<void>((r) => (resolve = r));
      done.set(key, { promise, resolve });
    }
    return done.get(key)!;
  };
  await page.route("**/*", async (route) => {
    const req = route.request();
    if (req.resourceType() !== "fetch" && req.resourceType() !== "xhr") return route.fallback();
    const base = junbanBaseKey(req.method(), req.url());
    const n = (counts.get(base) ?? 0) + 1;
    counts.set(base, n);
    const key = \`\${base}#\${n}\`;
    const response = await route.fetch();
    const waitFor = rules.filter(([, after]) => after === key).map(([before]) => gate(before).promise);
    await Promise.race([Promise.all(waitFor), new Promise((r) => setTimeout(r, 10_000))]);
    await route.fulfill({ response });
    await new Promise((r) => setTimeout(r, 50)); // let the page handle it before releasing the next one
    gate(key).resolve();
  });
});
// ---- end of Junban hook ----
`;
  lines.splice(last + 1, 0, hook);
  return lines.join("\n");
}

export function writeRepro(file: string, races: Race[]): string {
  const out = file.replace(/\.(spec|test)\.(ts|js|mjs)$/, ".junban-repro.$1.$2");
  const target = out === file ? file + ".junban-repro.spec.ts" : out;
  fs.writeFileSync(target, reproSource(fs.readFileSync(file, "utf8"), races));
  return path.resolve(target);
}
