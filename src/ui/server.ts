// `junban ui`: a small local server for the report. It serves the page and
// one API, POST /api/replay, which runs the test with an order you dragged
// into place and returns pass/fail plus the timeline.

import http from "node:http";
import fs from "node:fs";
import { runSchedules } from "../runner.js";
import type { HuntReport } from "../hunt.js";
import { renderPage } from "./page.js";

export function writeStaticReport(reports: HuntReport[], file: string) {
  fs.writeFileSync(file, renderPage(reports, false));
}

export function serveUi(reports: HuntReport[], port: number, _dir: string) {
  if (!reports.length) {
    console.log("No report yet. Run `junban hunt <spec-file>` first.");
    process.exit(1);
  }
  let busy = false;
  const server = http.createServer(async (req, res) => {
    if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(renderPage(reports, true));
      return;
    }
    if (req.method === "POST" && req.url === "/api/replay") {
      let body = "";
      for await (const chunk of req) body += chunk;
      try {
        const { file, title, order } = JSON.parse(body) as { file: string; title: string; order: string[] };
        const known = reports.find((r) => r.file === file && r.test === title);
        if (!known || !Array.isArray(order)) throw new Error("unknown test");
        if (busy) throw new Error("a replay is already running");
        busy = true;
        const t0 = Date.now();
        const batch = await runSchedules({ file, title, workers: 1 }, [order]).finally(() => (busy = false));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ result: batch.results[0], ms: Date.now() - t0 }));
      } catch (e) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: String((e as Error).message ?? e) }));
      }
      return;
    }
    res.writeHead(404).end();
  });
  server.listen(port, "127.0.0.1", () => console.log(`Junban report: http://localhost:${port}`));
}
