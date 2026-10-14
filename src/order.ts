// Pure helpers for orderings. No browser here, so these are unit-tested.

export type Rule = [before: string, after: string]; // "before" is released before "after"

/** Every way to move one request in front of an earlier one: n(n-1)/2 orders. */
export function pairSwaps(order: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < order.length; i++) {
    for (let j = i + 1; j < order.length; j++) {
      const s = order.slice();
      const [moved] = s.splice(j, 1);
      s.splice(i, 0, moved);
      out.push(s);
    }
  }
  return out;
}

/** Small seeded PRNG (mulberry32) so a hunt can be replayed exactly. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffles(order: string[], count: number, seed: number, skip: Set<string> = new Set()): string[][] {
  const rand = rng(seed);
  const seen = new Set(skip);
  seen.add(order.join("|"));
  const out: string[][] = [];
  const max = factorial(order.length);
  for (let tries = 0; out.length < count && seen.size < max && tries < count * 50; tries++) {
    const s = order.slice();
    for (let i = s.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [s[i], s[j]] = [s[j], s[i]];
    }
    const k = s.join("|");
    if (!seen.has(k)) {
      seen.add(k);
      out.push(s);
    }
  }
  return out;
}

function factorial(n: number): number {
  return n <= 1 ? 1 : n * factorial(n - 1);
}

/** Pairs that `order` flips compared to `baseline`: [x, y] = x now comes before y. */
export function inversions(baseline: string[], order: string[]): Rule[] {
  const pos = new Map(order.map((k, i) => [k, i]));
  const out: Rule[] = [];
  for (let i = 0; i < baseline.length; i++) {
    for (let j = i + 1; j < baseline.length; j++) {
      const a = baseline[i], b = baseline[j];
      if (pos.has(a) && pos.has(b) && pos.get(b)! < pos.get(a)!) out.push([b, a]);
    }
  }
  return out;
}

/**
 * The order closest to `baseline` that obeys every rule (a topological sort
 * that prefers baseline order). Returns null if the rules contradict.
 */
export function applyRules(baseline: string[], rules: Rule[]): string[] | null {
  const indeg = new Map(baseline.map((k) => [k, 0]));
  const edges = new Map<string, string[]>(baseline.map((k) => [k, []]));
  for (const [a, b] of rules) {
    if (!indeg.has(a) || !indeg.has(b)) continue;
    edges.get(a)!.push(b);
    indeg.set(b, indeg.get(b)! + 1);
  }
  const out: string[] = [];
  const left = new Set(baseline);
  while (left.size) {
    const next = baseline.find((k) => left.has(k) && indeg.get(k) === 0);
    if (next === undefined) return null; // cycle
    left.delete(next);
    out.push(next);
    for (const b of edges.get(next)!) indeg.set(b, indeg.get(b)! - 1);
  }
  return out;
}

/**
 * Delta debugging (Zeller's ddmin): shrink `items` to a small subset that
 * still makes `fails` true. Each round tests all candidate subsets in one
 * batch, so they can run in parallel.
 */
export async function ddmin<T>(items: T[], fails: (subsets: T[][]) => Promise<boolean[]>): Promise<T[]> {
  let c = items.slice();
  let n = 2;
  while (c.length >= 2) {
    const chunks = split(c, n);
    const complements = chunks.map((ch) => c.filter((x) => !ch.includes(x)));
    const res = await fails([...chunks, ...complements]);
    const hit = res.slice(0, chunks.length).findIndex(Boolean);
    if (hit >= 0) {
      c = chunks[hit];
      n = 2;
      continue;
    }
    const hitC = res.slice(chunks.length).findIndex(Boolean);
    if (hitC >= 0 && n > 2) {
      c = complements[hitC];
      n = Math.max(n - 1, 2);
      continue;
    }
    if (n >= c.length) break;
    n = Math.min(c.length, n * 2);
  }
  return c;
}

function split<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  const size = Math.ceil(xs.length / n);
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}
