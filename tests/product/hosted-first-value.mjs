// First-value path and phone layout against a hosted candidate (no routes).
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, devices } from "playwright-core";
import { waitForColdHome } from "./home-entry.mjs";
import { assertHostedCandidate, assertOnOrigin } from "./hosted-identity.mjs";

const origin = process.env.HOSTED_ORIGIN;
const shots = process.env.HOSTED_SHOTS ?? null;
if (!origin) { console.error("BLOCKED: HOSTED_ORIGIN is required."); process.exit(78); }
const candidate = await assertHostedCandidate(origin);
const errors = [];
const profile = await mkdtemp(path.join(tmpdir(), "tachiko-hosted-"));
let context;
// The value table only; surrounding copy and chart placement follow layout.
const results = async (page) => (await page.getByTestId("results-pane").innerText()).split("\n").filter((line) => /^\S+\t-?\d/.test(line)).join("|");
function assertPenResult(groups, expected, stage) {
  const penRows = groups.split("|").filter((line) => line.split("\t")[0] === "PEN");
  assert.deepEqual(penRows, [`PEN\t${expected}`], `${stage}: exactly one PEN group must equal ${expected}`);
}
async function start(options = {}) {
  context = await chromium.launchPersistentContext(profile, { headless: true, ...options });
  const page = context.pages()[0] ?? await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.setDefaultTimeout(30_000);
  await page.goto(origin);
  assertOnOrigin(page, origin);
  await waitForColdHome(page);
  return page;
}
try {
  let page = await start({ viewport: { width: 1440, height: 900 } });
  const t0 = Date.now();
  await page.getByRole("button", { name: "Open sales example", exact: true }).click();
  await page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
  const openMs = Date.now() - t0;
  const before = await results(page);
  assertPenResult(before, 800, "initial Sales result");
  const headers = await page.locator('table[aria-label="Table"] th[scope="col"]').allTextContents();
  const priceIndex = headers.indexOf("price") - 1;
  const pen = page.locator('table[aria-label="Table"] tbody tr').filter({ hasText: "PEN" }).first().locator("td").nth(priceIndex);
  await pen.dblclick();
  await page.getByRole("textbox", { name: "Edit cell", exact: true }).fill("250");
  await page.keyboard.press("Enter");
  await page.waitForFunction((old) => {
    const text = document.querySelector('[data-testid="results-pane"]')?.innerText ?? "";
    return text.includes("Up to date") && text.split("\n").filter((line) => /^\S+\t-?\d/.test(line)).join("|") !== old;
  }, before);
  const after = await results(page);
  assert.notEqual(after, before, "the result updates after a price change");
  assertPenResult(after, 1000, "price 250 result");
  if (shots) await page.screenshot({ path: `${shots}/hosted-desktop-sales.png` });
  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  await page.getByRole("textbox", { name: "Copy name", exact: true }).fill("hosted-sales");
  await page.getByRole("button", { name: "Create copy", exact: true }).click();
  await page.getByTestId("save-status").filter({ hasText: "Saved on this device" }).waitFor();
  await context.close();
  // Full browser restart on the same profile, then reopen the saved copy.
  page = await start({ ...devices["iPhone 13"], isMobile: undefined, hasTouch: true, viewport: { width: 390, height: 844 } });
  const overflowHome = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (shots) await page.screenshot({ path: `${shots}/hosted-mobile-home.png` });
  await page.getByRole("button", { name: "Open saved hosted-sales", exact: true }).click();
  await page.locator('[data-testid="project-ready"][aria-busy="false"]').waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="results-pane"]')?.innerText.includes("Up to date"));
  const reopened = await results(page);
  assertPenResult(reopened, 1000, "saved result after full browser restart");
  assert.equal(reopened, after, "saved result survives a full browser restart");
  const overflowWork = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (shots) await page.screenshot({ path: `${shots}/hosted-mobile-work.png` });
  assert.ok(overflowHome <= 0, `phone Home has no horizontal page scroll (${overflowHome}px)`);
  assert.ok(overflowWork <= 0, `phone workbook has no horizontal page scroll (${overflowWork}px)`);
  assert.deepEqual(errors, [], "no page or console errors");
  console.log(JSON.stringify({ case: "hosted first value + restart + phone layout", status: "PASS", origin, indexSha256: candidate.indexHash, candidateBound: candidate.candidateBound, openMs, resultsBefore: before.slice(0, 80), resultsAfter: after.slice(0, 80), resultsReopened: reopened.slice(0, 80), consoleOrPageErrors: errors.length }));
} finally {
  await context?.close().catch(() => undefined);
  await rm(profile, { recursive: true, force: true });
}
