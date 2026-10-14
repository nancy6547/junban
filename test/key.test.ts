import { describe, it, expect } from "vitest";
import { baseKey, BASE_KEY_SRC, KeyCounter, VOLATILE_PARAMS, shortKey } from "../src/key.js";
import ts from "typescript";

const urls = [
  ["GET", "http://localhost:3000/api/cart"],
  ["get", "http://localhost:3000/api/search?q=ab&page=2"],
  ["POST", "https://shop.dev/api/orders/1234567/items?_=1712345678901"],
  ["GET", "https://shop.dev/api/users/3f2a9c1e5b7d4e8a9c21?ts=1712345678901&sort=new"],
  ["GET", "https://shop.dev/api/a?b=2&a=1"],
];

describe("baseKey", () => {
  it("ignores cache busters and sorts query params", () => {
    expect(baseKey("get", "http://x/api/search?q=ab&_=123")).toBe("GET /api/search?q=ab");
    expect(baseKey("GET", "http://x/api/a?b=2&a=1")).toBe("GET /api/a?a=1&b=2");
  });
  it("replaces long ids in the path", () => {
    expect(baseKey("GET", "http://x/api/orders/1234567")).toBe("GET /api/orders/:n");
  });
  it("matches the copy pasted into repro tests", () => {
    const js = ts.transpileModule(`(${BASE_KEY_SRC})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const copy = new Function("VOLATILE_PARAMS", `return ${js}`)(VOLATILE_PARAMS);
    for (const [m, u] of urls) expect(copy(m, u)).toBe(baseKey(m, u));
  });
});

describe("KeyCounter", () => {
  it("numbers repeats of the same request", () => {
    const c = new KeyCounter();
    expect(c.next("GET", "http://x/api/a")).toBe("GET /api/a#1");
    expect(c.next("GET", "http://x/api/b")).toBe("GET /api/b#1");
    expect(c.next("GET", "http://x/api/a")).toBe("GET /api/a#2");
    expect(shortKey("GET /api/a#1")).toBe("/api/a");
    expect(shortKey("GET /api/a#2")).toBe("/api/a#2");
  });
});
