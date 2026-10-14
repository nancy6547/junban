import fs from "node:fs";
import type { HuntReport } from "../hunt.js";

const TEMPLATE = fs.readFileSync(new URL("./page.html", import.meta.url), "utf8");

/** The report page with the hunt results embedded. `live` enables replay. */
export function renderPage(reports: HuntReport[], live: boolean): string {
  const data = JSON.stringify({ reports, live }).replace(/</g, "\\u003c");
  return TEMPLATE.replace("/*__JUNBAN_DATA__*/null", data);
}
