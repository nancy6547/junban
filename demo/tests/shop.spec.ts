// Ordinary-looking Playwright tests for the demo shop. Each one passes most
// of the time and fails now and then, because of a race in the page.
import { test, expect } from "../../src/index.js";

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
