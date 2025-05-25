import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function accessible(page: Page) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(r.violations.map((v) => `${scheme}: ${v.id}`)).toEqual([]);
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test("readiness says how many invoices can go out and what holds the rest", async ({ page }) => {
  await expect(page.locator(".lede")).toHaveText(
    "14 draft invoices. 9 are ready to send as UAE electronic invoices; 5 are held by 2 customer records with gaps.",
  );
  await expect(page.locator(".golive")).toContainText("1 January 2027");
  await accessible(page);
});

test("fixing a customer record releases its invoices", async ({ page }) => {
  const awms = page.locator(".records li", { hasText: "Al Waha Municipal Services" });
  await awms.getByRole("button", { name: "Fix the record" }).click();
  await awms.getByLabel("TRN").fill("100311740200003");
  await awms.getByRole("button", { name: "Save the record" }).click();
  await expect(page.locator(".lede")).toContainText("12 are ready");
  await page.reload();
  await expect(page.locator(".lede")).toContainText("12 are ready"); // kept in this browser
  await page.getByRole("button", { name: "Undo the corrections" }).click();
  await expect(page.locator(".lede")).toContainText("9 are ready");
});

test("saving in a second tab keeps corrections made in the first", async ({ page, context }) => {
  const second = await context.newPage();
  await second.goto("/");
  const awms = page.locator(".records li", { hasText: "Al Waha Municipal Services" });
  await awms.getByRole("button", { name: "Fix the record" }).click();
  await awms.getByLabel("TRN").fill("100311740200003");
  await awms.getByRole("button", { name: "Save the record" }).click();
  const spac = second.locator(".records li", { hasText: "Seven Palms Academy" });
  await spac.getByRole("button", { name: "Fix the record" }).click();
  await spac.getByLabel("City").fill("Sharjah");
  await spac.getByRole("button", { name: "Save the record" }).click();
  await second.reload();
  await expect(second.locator(".lede")).toContainText("14 are ready");
  await page.reload();
  await expect(page.locator(".lede")).toContainText("14 are ready");
});

test("an invoice shows its 51 fields, the sum rules and its XML", async ({ page }) => {
  await page.getByRole("link", { name: "INV-2026-0001" }).click();
  await expect(page.locator(".fields h2")).toContainText("51 of 51");
  await expect(page.locator(".sums li")).toHaveCount(5);
  await page.getByRole("button", { name: "Show the XML" }).click();
  await expect(page.locator("pre.xml")).toContainText("urn:peppol:pint:billing-1@ae-1");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download the XML" }).click();
  expect((await download).suggestedFilename()).toBe("INV-2026-0001.xml");
  await accessible(page);
});

test("a held invoice says what to fix and where", async ({ page }) => {
  await page.goto("/invoices/INV-2026-0008");
  await expect(page.getByRole("heading", { name: "What to fix" })).toBeVisible();
  await expect(page.locator(".problems li").first()).toContainText("In the customer record");
});

test("phone width, no sideways scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/", "/invoices/INV-2026-0001"]) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  }
});
