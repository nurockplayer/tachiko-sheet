// Production-build evidence capture. Opens the committed corpus through the
// normal Sheet file input and asserts rendered text before taking screenshots.
import { chromium } from "playwright";

const url = process.env.WORK_CLIENT_URL;
if (!url) throw new Error("WORK_CLIENT_URL is required");
const fixture = "evidence/visual-foundation/fixture-50.roproj";
const cases = [
  [1440, 900, "workbook-50rows-1440x900.png"],
  [1280, 800, "workbook-50rows-1280x800.png"],
  [1024, 768, "workbook-50rows-1024x768.png"],
];
const browser = await chromium.launch({ headless: true });
try {
  for (const [width, height, name] of cases) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.getByTestId("open-project").setInputFiles(fixture);
    await page.getByTestId("project-ready").waitFor({ timeout: 15000 });
    const exact = await page.getByText("整理試玩回饋", { exact: true }).count();
    const mojibake = await page.getByText(/æ•´|çŽ©|å›ž/, { exact: false }).count();
    if (exact === 0 || mojibake !== 0) throw new Error(`rendered CJK check failed at ${width}x${height}: exact=${exact}, mojibake=${mojibake}`);
    await page.screenshot({ path: `evidence/visual-foundation/targets/${name}`, fullPage: true });
    if (width === 1440) {
      await page.locator(".ts-cell").first().focus();
      await page.screenshot({ path: "evidence/visual-foundation/targets/workbook-50rows-selection.png", fullPage: true });
    }
    console.log(JSON.stringify({ viewport: `${width}x${height}`, exact_cjk_cells: exact, mojibake_cells: mojibake, screenshot: name }));
    await page.close();
  }
} finally {
  await browser.close();
}
