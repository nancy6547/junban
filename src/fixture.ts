// Drop-in replacement for `@playwright/test`:
//
//   import { test, expect } from "junban";
//
// With no JUNBAN_PLAN set, it does nothing and your tests run as normal.
// When the Junban CLI runs your test, it sets JUNBAN_PLAN to a list of
// schedules. Run number i (Playwright's repeatEachIndex) uses schedule i, so
// many orderings run in ONE Playwright process, in parallel across workers.

import { test as base, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { Controller, type Schedule } from "./controller.js";

export interface Plan {
  schedules: Schedule[];
}

export interface RunResult {
  index: number;
  title: string;
  schedule: Schedule;
  status: "passed" | "failed";
  error?: string;
  releaseOrder: string[];
  events: Controller["events"];
}

function loadPlan(): Plan | null {
  const file = process.env.JUNBAN_PLAN;
  if (!file) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as Plan;
}

const plan = loadPlan();

export const test = base.extend<{ junban: void }>({
  junban: [
    async ({ page }, use, testInfo) => {
      if (!plan) {
        await use();
        return;
      }
      const index = testInfo.repeatEachIndex;
      const schedule = plan.schedules[index] ?? null;
      const ctl = new Controller(page, schedule);
      await ctl.attach();
      await use();
      await ctl.detach();

      const failed = testInfo.errors.length > 0 || (testInfo.status !== undefined && testInfo.status !== testInfo.expectedStatus);
      const result: RunResult = {
        index,
        title: testInfo.title,
        schedule,
        status: failed ? "failed" : "passed",
        error: testInfo.errors[0]?.message?.replace(/\x1b\[[0-9;]*m/g, "").split("\n").slice(0, 6).join("\n"),
        releaseOrder: ctl.releaseOrder(),
        events: ctl.events,
      };
      const out = process.env.JUNBAN_OUT!;
      fs.mkdirSync(out, { recursive: true });
      fs.writeFileSync(path.join(out, `run-${index}.json`), JSON.stringify(result));
    },
    { auto: true },
  ],
});

export { expect };
