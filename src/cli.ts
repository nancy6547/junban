#!/usr/bin/env node
// junban hunt <spec-file> [-g "test title"] [--budget 60] [--workers 4] [--seed 1]
// junban ui [--port 4321]

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { hunt, type HuntReport } from "./hunt.js";
import { writeRepro } from "./repro.js";
import { playwrightCli } from "./runner.js";
import { shortKey } from "./key.js";
import { writeStaticReport, serveUi } from "./ui/server.js";

const REPORT_DIR = "junban-report";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

/** Ask Playwright which tests are in a file. */
function listTests(file: string): string[] {
  const r = spawnSync(process.execPath, [playwrightCli(), "test", file, "--list", "--reporter", "json"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const titles: string[] = [];
  const walk = (s: any) => {
    for (const spec of s.specs ?? []) titles.push(spec.title);
    for (const sub of s.suites ?? []) walk(sub);
  };
  const json = JSON.parse(r.stdout.slice(r.stdout.indexOf("{")));
  for (const s of json.suites ?? []) walk(s);
  return [...new Set(titles)];
}

function loadReports(): HuntReport[] {
  const f = path.join(REPORT_DIR, "report.json");
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : [];
}

function saveReports(reports: HuntReport[]) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORT_DIR, "report.json"), JSON.stringify(reports, null, 2));
  writeStaticReport(reports, path.join(REPORT_DIR, "index.html"));
}

const say = (s = "") => process.stdout.write(s + "\n");
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

async function cmdHunt() {
  const file = process.argv[3];
  if (!file || !fs.existsSync(file)) {
    say("usage: junban hunt <spec-file> [-g \"test title\"] [--budget 60] [--workers 4] [--seed 1]");
    process.exit(2);
  }
  const titles = arg("-g") ? [arg("-g")!] : listTests(file);
  const reports = loadReports();

  for (const title of titles) {
    say(bold(`\n● ${title}`));
    const r = await hunt({
      file,
      title,
      budget: Number(arg("--budget", "60")),
      workers: Number(arg("--workers", "4")),
      seed: Number(arg("--seed", "1")),
      log: (m) => say(dim("  " + m)),
    });
    if (r.verdict === "race-found") {
      const rule = r.rules.map(([a, b]) => `${shortKey(a)} arrives before ${shortKey(b)}`).join(" AND ");
      say(`  ${bold("RACE FOUND")} fails when ${rule}`);
      say(`  first failure on run ${r.runsToFailure}; ${r.totalRuns} runs in total incl. shrinking (${(r.ms / 1000).toFixed(1)}s); minimal order fails ${r.confirm!.failed}/${r.confirm!.runs}`);
    } else if (r.verdict === "fails-without-reordering") {
      say(`  test fails even in normal runs; not a response-order race`);
    } else {
      say(`  no response-order race found in ${r.explored} orders (${r.totalRuns} runs)`);
    }
    const at = reports.findIndex((x) => x.file === file && x.test === title);
    if (at >= 0) reports[at] = r;
    else reports.push(r);
    saveReports(reports);
  }
  const races = reports.filter((r) => r.file === file && r.verdict === "race-found").map((r) => ({ title: r.test, rules: r.rules }));
  if (races.length) {
    const repro = writeRepro(file, races);
    say(`\nrepro test (needs only @playwright/test): ${path.relative(process.cwd(), repro)}`);
  }
  say(`report: ${path.join(REPORT_DIR, "index.html")}   (interactive: npx junban ui)`);
}

async function main() {
  const cmd = process.argv[2];
  if (cmd === "hunt") return cmdHunt();
  if (cmd === "ui") return serveUi(loadReports(), Number(arg("--port", "4321")), REPORT_DIR);
  say("junban: find the network response order that breaks a flaky Playwright test\n");
  say("  junban hunt <spec-file> [-g \"test title\"]   hunt for races, write repro + report");
  say("  junban ui [--port 4321]                     open the report with drag-to-replay");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
