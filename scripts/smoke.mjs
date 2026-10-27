/** Browser regression checks against a running dev server. No production data or credentials. */
import { chromium } from "playwright";
import assert from "node:assert/strict";
const base = process.env.SMOKE_URL || "http://127.0.0.1:5173";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ["--no-sandbox"],
});
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("Failed to load resource"))
      errors.push(m.text());
  });
  await page.goto(base + "/#/flights/new");
  await page.getByText("Quick entry", { exact: false }).first().click();
  await page
    .getByPlaceholder("SAN → LAX 2026-11-15 UA123")
    .fill("SAN-LAX 2026-11-15");
  await page.getByRole("button", { name: "Fill flight details" }).click();
  await page.getByRole("button", { name: "Save flight", exact: true }).click();
  await page.waitForURL(/#\/flights\/(?!new)[^/?]+$/);
  assert.equal(
    await page.getByText("Something went wrong", { exact: true }).count(),
    0,
  );
  await page.goto(base + "/#/");
  await page.getByRole("heading", { name: "Your flight journal" }).waitFor();
  assert(await page.getByRole("link", { name: /View full log/ }).isVisible());
  await page.getByRole("link", { name: /View full log/ }).click();
  await page
    .getByRole("heading", { name: "Flight log", exact: true })
    .waitFor();
  await page.goto(base + "/#/settings");
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export CSV/ }).click();
  const download = await downloaded;
  assert(download.suggestedFilename().endsWith(".csv"));
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of [
      "/",
      "/flights",
      "/stats",
      "/import",
      "/flights/new",
    ]) {
      await page.goto(base + "/#" + route);
      await page.locator("main").waitFor();
      await page.waitForTimeout(350);
      assert.equal(
        await page.getByText("Something went wrong", { exact: true }).count(),
        0,
        route,
      );
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        `Overflow ${route} ${width}`,
      );
    }
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS: direct entry, quick fill, save, full log, CSV download, and five screens at three widths.",
  );
} finally {
  await browser.close();
}
