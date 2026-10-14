// Ordinary-looking Playwright tests for the demo shop. Each one passes most
// of the time and fails now and then, because of a race in the page.
import { test, expect } from "@playwright/test";

// ---- added by Junban: forces the response order that breaks each test ----
// "search shows results for the full query" fails when GET /api/search?q=ab#1 arrives before GET /api/search?q=a#1
// "products show the sale badge" fails when GET /api/products#1 arrives before GET /api/flags#1
// "price shows the live price" fails when GET /api/price/live#1 arrives before GET /api/price#1
// "orders greet the signed-in user" fails when GET /api/orders#1 arrives before GET /api/profile#1
// "recommendations use the dark theme" fails when GET /api/recs#1 arrives before GET /api/theme#1
// "cart shows the total in rupees" fails when GET /api/cart#1 arrives before GET /api/user#1
const JUNBAN_RACES: Record<string, [string, string][]> = {
  "search shows results for the full query": [
    [
      "GET /api/search?q=ab#1",
      "GET /api/search?q=a#1"
    ]
  ],
  "products show the sale badge": [
    [
      "GET /api/products#1",
      "GET /api/flags#1"
    ]
  ],
  "price shows the live price": [
    [
      "GET /api/price/live#1",
      "GET /api/price#1"
    ]
  ],
  "orders greet the signed-in user": [
    [
      "GET /api/orders#1",
      "GET /api/profile#1"
    ]
  ],
  "recommendations use the dark theme": [
    [
      "GET /api/recs#1",
      "GET /api/theme#1"
    ]
  ],
  "cart shows the total in rupees": [
    [
      "GET /api/cart#1",
      "GET /api/user#1"
    ]
  ]
};
const VOLATILE_PARAMS = new Set(["_","t","ts","timestamp","cachebust","cb","nonce","rand"]);
const junbanBaseKey = (method: string, rawUrl: string): string => {
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
};

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
    const key = `${base}#${n}`;
    const response = await route.fetch();
    const waitFor = rules.filter(([, after]) => after === key).map(([before]) => gate(before).promise);
    await Promise.race([Promise.all(waitFor), new Promise((r) => setTimeout(r, 10_000))]);
    await route.fulfill({ response });
    await new Promise((r) => setTimeout(r, 50)); // let the page handle it before releasing the next one
    gate(key).resolve();
  });
});
// ---- end of Junban hook ----


test("cart shows the total in rupees", async ({ page }) => {
  await page.goto("/cart.html");
  await expect(page.locator("#total")).toHaveText("3 items, ₹1299");
});

test("search shows results for the full query", async ({ page }) => {
  await page.goto("/search.html");
  await page.locator("#q").pressSequentially("ab");
  await page.waitForLoadState("networkidle");
  await expect(page.locator("#results li").first()).toHaveText("ab shoes");
});

test("products show the sale badge", async ({ page }) => {
  await page.goto("/products.html");
  await expect(page.locator("#products li")).toHaveCount(3);
  await expect(page.locator(".sale")).toHaveCount(3);
});

test("price shows the live price", async ({ page }) => {
  await page.goto("/price.html");
  await page.waitForLoadState("networkidle");
  await expect(page.locator("#price")).toHaveText("₹549 (live)");
});

test("orders greet the signed-in user", async ({ page }) => {
  await page.goto("/orders.html");
  await expect(page.locator("#greeting")).toHaveText("Hi Nancy, 3 orders");
});

test("recommendations use the dark theme", async ({ page }) => {
  await page.goto("/recs.html");
  await expect(page.locator("#recs li")).toHaveCount(2);
  await expect(page.locator("#recs li.dark")).toHaveCount(2);
});

test("ok page: cart total (no bug)", async ({ page }) => {
  await page.goto("/ok.html");
  await expect(page.locator("#total")).toHaveText("3 items, ₹1299");
});
