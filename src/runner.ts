// Runs one Playwright test under a list of schedules, all in ONE Playwright
// process: run i uses schedule i (via --repeat-each + repeatEachIndex).

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Schedule } from "./controller.js";
import type { RunResult } from "./fixture.js";

export interface RunOptions {
  file: string; // spec file
  title: string; // exact test title
  workers?: number;
  cwd?: string;
  playwrightArgs?: string[];
}

export interface Batch {
  results: RunResult[];
  ms: number;
}

/** Path to the project's own Playwright CLI, so we run it with node directly (no shell quoting issues on Windows). */
export function playwrightCli(cwd = process.cwd()): string {
  const require = createRequire(path.join(cwd, "package.json"));
  return require.resolve("@playwright/test/cli");
}

let totalRuns = 0;
export const runCounter = { get: () => totalRuns, reset: () => (totalRuns = 0) };

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function runSchedules(opts: RunOptions, schedules: Schedule[]): Promise<Batch> {
  if (schedules.length === 0) return { results: [], ms: 0 };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "junban-"));
  const planFile = path.join(dir, "plan.json");
  const outDir = path.join(dir, "out");
  fs.writeFileSync(planFile, JSON.stringify({ schedules }));

  const args = [
    playwrightCli(opts.cwd),
    "test",
    opts.file,
    "-g",
    `^(.* )?${escapeRegex(opts.title)}$`,
    "--repeat-each",
    String(schedules.length),
    "--retries",
    "0",
    "--workers",
    String(opts.workers ?? Math.min(4, schedules.length)),
    "--reporter",
    "dot",
    ...(opts.playwrightArgs ?? []),
  ];
  const t0 = Date.now();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: opts.cwd ?? process.cwd(),
      env: { ...process.env, FORCE_COLOR: "0", JUNBAN_PLAN: planFile, JUNBAN_OUT: outDir },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let err = "";
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", () => resolve()); // test failures exit non-zero; that's expected
  });
  const ms = Date.now() - t0;

  const results: RunResult[] = [];
  for (let i = 0; i < schedules.length; i++) {
    const f = path.join(outDir, `run-${i}.json`);
    if (fs.existsSync(f)) results.push(JSON.parse(fs.readFileSync(f, "utf8")));
  }
  totalRuns += schedules.length;
  fs.rmSync(dir, { recursive: true, force: true });
  if (results.length === 0) {
    throw new Error(`No results from Playwright. Is the test title right? (${opts.title})`);
  }
  return { results, ms };
}
