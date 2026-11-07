// The grid canary's cases (Sheet #327 G1a/G1b/G1c, slice 1b's G2a–G2d),
// tested from TypeScript. `nsh test` runs this file in a headless runner it
// builds with the crate, and `open(".")` starts the Rust root (`nsh.json`
// "root"). Desktop size from slice 1b on, and a 120 s limit for every case:
// Linux window key presses cost ~27 s each.
import { expect, open, test } from "nsh/test";

const status = (app: Awaited<ReturnType<typeof open>>) =>
  app.texts().find((text) => text.startsWith("grid "))!;

const rangeText = (app: Awaited<ReturnType<typeof open>>) =>
  app.texts().find((text) => text.startsWith("range "))!;

// `range R<r1>C<c1>:R<r2>C<c2>` → [r1, c1, r2, c2].
const range = (text: string) => {
  const match = text.match(/range R(\d+)C(\d+):R(\d+)C(\d+)/);
  if (!match) throw new Error(`no range in ${JSON.stringify(text)}`);
  return match.slice(1).map(Number);
};

test(
  "G1a/G1b: last row and last column reachable, title and first column stay",
  async () => {
    const app = await open(".", { width: 1440, height: 900 });
    const [, row, column] = status(app).match(/last R(\d+)C(\d+)/)!;
    await app.press("id:jump-last");
    await app.waitUntil(() => app.texts().includes(`R${row}C${column}`));
    expect(app.texts().includes(`R${row}C0`)).toBe(true); // frozen first column
    expect(app.texts().includes("C0")).toBe(true); // title row
  },
  120000,
);

test(
  "G1c: scroll sweep",
  async () => {
    const app = await open(".", { width: 1440, height: 900 });
    for (let i = 0; i < 3; i++) await app.scroll("id:grid-wrap", 4800);
    expect(app.texts().some((t) => /^R\d+C0$/.test(t) && t !== "R0C0")).toBe(true);
  },
  120000,
);

test(
  "G2a: a drag selects a range",
  async () => {
    const app = await open(".", { width: 1440, height: 900 });
    await app.drag("id:grid-wrap", { x: 200, y: 96 });
    await app.waitUntil(() => rangeText(app) !== "range none");
    const text = rangeText(app);
    console.log(`G2a range ${text}`);
    const [r1, c1, r2, c2] = range(text);
    expect(r2 - r1 + 1).toBeGreaterThanOrEqual(4); // at least 4 rows
    expect(c2 - c1 + 1).toBeGreaterThanOrEqual(2); // at least 2 columns
  },
  120000,
);

test(
  "G2b: a Shift press extends the range",
  async () => {
    const app = await open(".", { width: 1440, height: 900 });
    await app.press("id:select-b2");
    await app.keyboard.down("shift");
    await app.press("text:R5C3");
    await app.keyboard.up("shift");
    await app.waitUntil(() => rangeText(app) === "range R2C1:R5C3");
    expect(rangeText(app)).toBe("range R2C1:R5C3");
  },
  120000,
);

test(
  "G2c: Shift arrows grow the range, a plain arrow collapses it",
  async () => {
    const app = await open(".", { width: 1440, height: 900 });
    await app.press("id:select-b2");
    await app.keyboard.press("shift+down");
    await app.keyboard.press("shift+down");
    await app.keyboard.press("shift+right");
    await app.waitUntil(() => rangeText(app) === "range R2C1:R4C2");
    expect(rangeText(app)).toBe("range R2C1:R4C2");
    await app.keyboard.press("right");
    await app.waitUntil(() => rangeText(app) === "range R2C2:R2C2");
    expect(rangeText(app)).toBe("range R2C2:R2C2");
  },
  120000,
);

test(
  "G2d: a drag after scrolling selects rows down there",
  async () => {
    const app = await open(".", { width: 1440, height: 900 });
    await app.scroll("id:grid-wrap", 4800);
    await app.drag("id:grid-wrap", { x: 200, y: 96 });
    await app.waitUntil(() => rangeText(app) !== "range none");
    const text = rangeText(app);
    const first = app.texts().find((t) => t.startsWith("first "));
    console.log(`G2d range ${text} ${first}`);
    const [r1] = range(text);
    expect(r1).toBeGreaterThanOrEqual(150); // moved with the scroll
  },
  120000,
);
