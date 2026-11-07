import { describe, expect, it } from "vitest";
import { decodeOpenedFile } from "./opened-file";

function frame(status: number, text: string, bytes: number[] = []): Uint8Array {
  const name = new TextEncoder().encode(text);
  return new Uint8Array([status, name.length, 0, 0, 0, ...name, ...bytes]);
}

describe("decodeOpenedFile", () => {
  it("answers null when no file is waiting", () => {
    expect(decodeOpenedFile(new Uint8Array(0))).toBeNull();
  });

  it("gives the file its name, bytes and spreadsheet type", async () => {
    const opened = decodeOpenedFile(frame(0, "預算.csv", [97, 44, 98]));
    if (!opened || !("file" in opened)) throw new Error("no file");
    expect(opened.file.name).toBe("預算.csv");
    expect(opened.file.type).toBe("text/csv");
    expect(await opened.file.text()).toBe("a,b");
  });

  it("gives a work file no spreadsheet type", () => {
    const opened = decodeOpenedFile(frame(0, "work.ro"));
    if (!opened || !("file" in opened)) throw new Error("no file");
    expect(opened.file.type).toBe("");
  });

  it("passes on the host's refusal", () => {
    expect(decodeOpenedFile(frame(1, "too large"))).toEqual({ refused: "too large" });
  });

  it("rejects a truncated reply", () => {
    expect(() => decodeOpenedFile(new Uint8Array([0, 9]))).toThrow(/malformed/);
    expect(() => decodeOpenedFile(new Uint8Array([0, 9, 0, 0, 0, 97]))).toThrow(/malformed/);
  });
});
