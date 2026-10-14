// Demo shop with planted race conditions. Every page fetches data in
// parallel, and each one has a bug that only shows up when the responses
// arrive in an unlucky order. Latency is random, so the tests are flaky:
// they pass most of the time and fail now and then.
import express from "express";
import path from "node:path";

const app = express();
const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
// RARE=1 narrows the overlap between latencies, so each race shows up only
// a few times in a thousand runs: the kind of flake that's hardest to catch.
const RARE = process.env.RARE === "1";
const r = (common: [number, number], rare: [number, number]) => (RARE ? rare : common);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Each endpoint: [min latency, max latency] in ms, then the JSON it returns.
function api(route: string, lo: number, hi: number, body: (req: express.Request) => unknown) {
  app.get(route, async (req, res) => {
    await sleep(rand(lo, hi));
    res.json(body(req));
  });
}

// 1. cart-user: cart renders with the user's currency
api("/api/user", ...r([30, 260], [30, 210]), () => ({ name: "Nancy", currency: "₹" }));
api("/api/cart", ...r([200, 400], [200, 400]), () => ({ items: 3, total: 1299 }));

// 2. stale-search: short queries answer faster than long ones
app.get("/api/search", async (req, res) => {
  const q = String(req.query.q ?? "");
  await sleep(q.length <= 1 ? rand(...r([40, 160], [40, 135])) : rand(...r([120, 250], [125, 250])));
  res.json({ q, results: [`${q} shoes`, `${q} bag`] });
});

// 3. flags-late: products render once, reading feature flags at that moment
api("/api/flags", ...r([20, 140], [20, 110]), () => ({ showSale: true }));
api("/api/products", ...r([100, 300], [100, 300]), () => ({ products: ["Lamp", "Desk", "Chair"] }));

// 4. stale-price: initial price and live price; whichever lands last wins
api("/api/price", ...r([20, 250], [20, 230]), () => ({ price: 499, live: false }));
api("/api/price/live", ...r([220, 400], [220, 400]), () => ({ price: 549, live: true }));

// 5. orders-first: needs session AND profile before orders render
api("/api/session", ...r([20, 200], [20, 160]), () => ({ ok: true }));
api("/api/profile", ...r([20, 200], [20, 160]), () => ({ name: "Nancy" }));
api("/api/orders", ...r([150, 350], [150, 350]), () => ({ count: 3 }));

// 6. recs-theme: recs are only requested after the session (dependent request)
api("/api/theme", ...r([20, 150], [20, 100]), () => ({ theme: "dark" }));
api("/api/recs", ...r([60, 160], [60, 160]), () => ({ recs: ["Mug", "Pen"] }));

app.use(express.static(path.join(import.meta.dirname, "public")));

const port = Number(process.env.PORT ?? 4310);
app.listen(port, () => console.log(`demo shop on http://localhost:${port}`));
