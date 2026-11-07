// The grid canary's cases (Sheet #327 G1a/G1b/G1c), tested from TypeScript.
// `nsh test` runs this file in a headless runner it builds with the crate,
// and `open(".")` starts the Rust root (`nsh.json` "root").
import { expect, open, test } from "nsh/test";

const status = (app: Awaited<ReturnType<typeof open>>) =>
  app.texts().find((text) => text.startsWith("grid "))!;

test("G1a/G1b: last row and last column reachable, title and first column stay", async () => {
  const app = await open(".");
  const [, row, column] = status(app).match(/last R(\d+)C(\d+)/)!;
  await app.press("id:jump-last");
  await app.waitUntil(() => app.texts().includes(`R${row}C${column}`));
  expect(app.texts().includes(`R${row}C0`)).toBe(true); // frozen first column
  expect(app.texts().includes("C0")).toBe(true); // title row
});

test("G1c: scroll sweep", async () => {
  const app = await open(".");
  for (let i = 0; i < 3; i++) await app.scroll("id:grid-wrap", 4800);
  expect(app.texts().some((t) => /^R\d+C0$/.test(t) && t !== "R0C0")).toBe(true);
});
