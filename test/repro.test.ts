import { describe, it, expect } from "vitest";
import { reproSource } from "../src/repro.js";

const spec = `import { test, expect } from "junban";\r\nimport fs from "node:fs";\r\n\r\ntest("cart", async ({ page }) => {\r\n  await page.goto("/");\r\n});\r\n`;

describe("reproSource", () => {
  const out = reproSource(spec, [{ title: "cart", rules: [["GET /api/cart#1", "GET /api/user#1"]] }]);
  it("switches the import back to plain Playwright", () => {
    expect(out).toContain(`import { test, expect } from "@playwright/test";`);
    expect(out).toContain(`import fs from "node:fs";`);
    expect(out).not.toContain(`from "junban"`);
  });
  it("puts the hook after the last import, before the tests", () => {
    expect(out.indexOf("JUNBAN_RACES")).toBeGreaterThan(out.indexOf(`import fs`));
    expect(out.indexOf("JUNBAN_RACES")).toBeLessThan(out.indexOf(`test("cart"`));
  });
  it("stores the rule for that test", () => {
    expect(out).toContain(`"cart": [`);
    expect(out).toContain(`"GET /api/cart#1"`);
  });
});
