// A request "key" names a request so we can find the same request again in
// another run of the same test: method + path + query, plus "#n" for the
// n-th time that same request is sent.
//
//   GET /api/search?q=ab#1
//
// Values that change every run (cache busters, long ids, timestamps) are
// replaced so the key stays stable across runs.

export const VOLATILE_PARAMS = new Set(["_", "t", "ts", "timestamp", "cachebust", "cb", "nonce", "rand"]);

export function baseKey(method: string, rawUrl: string): string {
  const url = new URL(rawUrl);
  const path = url.pathname
    .split("/")
    .map((seg) => (/^\d{4,}$/.test(seg) ? ":n" : /^[0-9a-f-]{16,}$/i.test(seg) ? ":id" : seg))
    .join("/");
  const params = [...url.searchParams.entries()]
    .filter(([k]) => !VOLATILE_PARAMS.has(k.toLowerCase()))
    .map(([k, v]) => `${k}=${/^\d{10,}$/.test(v) ? ":n" : v}`)
    .sort();
  return `${method.toUpperCase()} ${path}${params.length ? "?" + params.join("&") : ""}`;
}

/** Hands out keys with an occurrence counter, in the order requests are sent. */
export class KeyCounter {
  private counts = new Map<string, number>();
  next(method: string, url: string): string {
    const base = baseKey(method, url);
    const n = (this.counts.get(base) ?? 0) + 1;
    this.counts.set(base, n);
    return `${base}#${n}`;
  }
}

/** "GET /api/cart#1" -> "/api/cart" (for display) */
export function shortKey(key: string): string {
  const k = key.replace(/^[A-Z]+ /, "");
  return k.endsWith("#1") ? k.slice(0, -2) : k;
}

/**
 * The same function as `baseKey`, as readable source text. Junban pastes it
 * into generated repro tests so they don't depend on Junban. A unit test
 * checks it gives the same keys as `baseKey`.
 */
export const BASE_KEY_SRC = `(method: string, rawUrl: string): string => {
  const url = new URL(rawUrl);
  const path = url.pathname
    .split("/")
    .map((seg) => (/^\\d{4,}$/.test(seg) ? ":n" : /^[0-9a-f-]{16,}$/i.test(seg) ? ":id" : seg))
    .join("/");
  const params = [...url.searchParams.entries()]
    .filter(([k]) => !VOLATILE_PARAMS.has(k.toLowerCase()))
    .map(([k, v]) => \`\${k}=\${/^\\d{10,}$/.test(v) ? ":n" : v}\`)
    .sort();
  return \`\${method.toUpperCase()} \${path}\${params.length ? "?" + params.join("&") : ""}\`;
}`;
