import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const address = "http://127.0.0.1:8080";
  await page.goto(address + "/login", { waitUntil: "domcontentloaded" });
  const username = page.locator("input#username, input[name='username']").first();
  await username.waitFor({ timeout: 25000 });
  await username.fill("admin");
  await page.locator("input#password, input[name='password']").first().fill("admin");
  const auth = page.waitForResponse((response) =>
    response.url().includes("/api/authenticate") && response.request().method() === "POST", { timeout: 20000 });
  await page.locator("button[type='submit']").first().click();
  const response = await auth;
  console.log("A0_BROWSER_LOGIN_HTTP_STATUS=" + response.status());
  assert.equal(response.status(), 200);
  await page.goto(address + "/tool", { waitUntil: "domcontentloaded" });
  const row = page.locator("table tbody tr").filter({ hasText: "A0-REAL-001" }).first();
  await row.waitFor({ timeout: 20000 });
  assert.match(await row.innerText(), /A0-REAL-001/);
  const screenshot = await page.screenshot({ fullPage: true });
  console.log("A0_CHROMIUM_SCREENSHOT_SHA256=" + createHash("sha256").update(screenshot).digest("hex"));
  console.log("A0_CHROMIUM_VIEWPORT=390x844");
  console.log("A0_CHROMIUM_REAL_DB_LIST_PASS");
} finally {
  await browser.close();
}
