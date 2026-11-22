import { expect, it } from "vitest";
import { companionDigest, companionMetadata, fileCompanion, openedCompanions } from "./import-companion.js";
import { decodeOpenedFile } from "./opened-file.js";

it("returns Work's companion unchanged only for the paired bytes", async () => {
  const bytes = new Uint8Array([1, 2, 3]).buffer;
  const metadata = { version: 1 as const, sheets: [] };
  const companion = { snapshotDigest: await companionDigest(bytes), metadata };
  expect(await companionMetadata(bytes, companion)).toBe(metadata);
  expect(await companionMetadata(new Uint8Array([3, 2, 1]).buffer, companion)).toBeUndefined();
  expect(await companionMetadata(bytes)).toBeUndefined();
});

it("decodes a desktop sidecar separately without changing the .ro bytes", async () => {
  const name = new TextEncoder().encode("book.ro");
  const companion = new TextEncoder().encode('{"snapshotDigest":"digest","metadata":{}}');
  const frame = new Uint8Array(9 + name.length + companion.length + 3);
  frame[0] = 2;
  const view = new DataView(frame.buffer);
  view.setUint32(1, name.length, true);
  frame.set(name, 5);
  view.setUint32(5 + name.length, companion.length, true);
  frame.set(companion, 9 + name.length);
  frame.set([1, 2, 3], 9 + name.length + companion.length);
  const opened = decodeOpenedFile(frame);
  if (!opened || !("file" in opened)) throw new Error("no file");
  expect(Array.from(new Uint8Array(await opened.file.arrayBuffer()))).toEqual([1, 2, 3]);
  expect(await fileCompanion(opened.file, new ArrayBuffer(0))).toEqual(JSON.parse(new TextDecoder().decode(companion)));
  openedCompanions.set(opened.file, "broken JSON");
  expect(await fileCompanion(opened.file, new ArrayBuffer(0))).toBeUndefined();
});
