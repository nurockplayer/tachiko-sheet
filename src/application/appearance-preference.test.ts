import { describe, expect, it } from "vitest";
import {
  DEFAULT_APPEARANCE_SELECTION,
  createAppearancePreferenceController,
  type AppearanceSelection,
  type RawAppearancePreferencePort,
} from "./appearance-preference.js";

const record = (profileId = "familiar-spreadsheet", density = "comfortable") =>
  JSON.stringify({ schemaVersion: 1, profileId, density });

function memoryPort(initial: string | null = null) {
  let value = initial;
  const writes: string[] = [];
  const port: RawAppearancePreferencePort = {
    read: () => value,
    write: (next) => {
      writes.push(next);
      value = next;
    },
  };
  return { port, writes, readValue: () => value };
}

describe("application appearance preference", () => {
  it("uses Tachiko/compact for a missing record, applies once, and does not write on load", () => {
    const storage = memoryPort();
    const applied: AppearanceSelection[] = [];
    const controller = createAppearancePreferenceController(storage.port, (selection) => applied.push(selection));

    expect(controller.getSnapshot().selection).toEqual(DEFAULT_APPEARANCE_SELECTION);
    expect(controller.getSnapshot().notice).toBeNull();
    expect(applied).toEqual([DEFAULT_APPEARANCE_SELECTION]);
    expect(storage.writes).toEqual([]);
  });

  it("loads an exact supported record without rewriting it", () => {
    const storage = memoryPort(record());
    const applied: AppearanceSelection[] = [];
    const controller = createAppearancePreferenceController(storage.port, (selection) => applied.push(selection));

    expect(controller.getSnapshot().selection).toEqual({
      profileId: "familiar-spreadsheet",
      density: "comfortable",
    });
    expect(controller.getSnapshot().notice).toBeNull();
    expect(applied).toHaveLength(1);
    expect(storage.writes).toEqual([]);
  });

  it.each([
    ["malformed JSON", "{"],
    ["unsupported schema", JSON.stringify({ schemaVersion: 2, profileId: "tachiko", density: "compact" })],
    ["unknown profile", record("custom", "compact")],
    ["unknown density", record("minimal-focus", "spacious")],
    ["extra field", JSON.stringify({ schemaVersion: 1, profileId: "tachiko", density: "compact", extra: 1 })],
    ["prototype-shaped extra field", '{"schemaVersion":1,"profileId":"tachiko","density":"compact","__proto__":{}}'],
    ["non-object", "null"],
  ])("falls back and discloses %s", (_label, raw) => {
    const storage = memoryPort(raw);
    const applied: AppearanceSelection[] = [];
    const controller = createAppearancePreferenceController(storage.port, (selection) => applied.push(selection));

    expect(controller.getSnapshot().selection).toEqual(DEFAULT_APPEARANCE_SELECTION);
    expect(controller.getSnapshot().notice).toBe("invalid-preference");
    expect(applied).toEqual([DEFAULT_APPEARANCE_SELECTION]);
    expect(storage.writes).toEqual([]);
  });

  it("falls back and discloses a read exception", () => {
    const applied: AppearanceSelection[] = [];
    const controller = createAppearancePreferenceController({
      read: () => { throw new Error("storage disabled"); },
      write: () => { throw new Error("storage disabled"); },
    }, (selection) => applied.push(selection));

    expect(controller.getSnapshot().selection).toEqual(DEFAULT_APPEARANCE_SELECTION);
    expect(controller.getSnapshot().notice).toBe("preference-unavailable");
    expect(controller.getSnapshot().notSaved).toBe(false);
    expect(applied).toEqual([DEFAULT_APPEARANCE_SELECTION]);
  });

  it("applies a user choice before writing the exact versioned record", () => {
    const events: string[] = [];
    const controller = createAppearancePreferenceController({
      read: () => null,
      write: (value) => events.push(`write:${value}`),
    }, (selection) => events.push(`apply:${selection.profileId}/${selection.density}`));

    controller.select("minimal-focus", "comfortable");

    expect(events).toEqual([
      "apply:tachiko/compact",
      "apply:minimal-focus/comfortable",
      'write:{"schemaVersion":1,"profileId":"minimal-focus","density":"comfortable"}',
    ]);
    expect(controller.getSnapshot().notSaved).toBe(false);
  });

  it("keeps the session choice after write failure and clears the sticky notice after a successful retry", () => {
    let fail = true;
    const saved: string[] = [];
    const controller = createAppearancePreferenceController({
      read: () => null,
      write: (value) => {
        if (fail) throw new Error("quota");
        saved.push(value);
      },
    }, () => {});

    controller.select("familiar-spreadsheet", "compact");
    expect(controller.getSnapshot().selection).toEqual({ profileId: "familiar-spreadsheet", density: "compact" });
    expect(controller.getSnapshot().notSaved).toBe(true);

    fail = false;
    controller.select("familiar-spreadsheet", "compact");
    expect(controller.getSnapshot().notSaved).toBe(false);
    expect(saved).toEqual(['{"schemaVersion":1,"profileId":"familiar-spreadsheet","density":"compact"}']);
  });

  it("queues only the latest choice during composition and defers apply and persistence", () => {
    const applied: string[] = [];
    const writes: string[] = [];
    const controller = createAppearancePreferenceController({
      read: () => null,
      write: (value) => writes.push(value),
    }, (selection) => applied.push(`${selection.profileId}/${selection.density}`));
    expect(applied).toEqual(["tachiko/compact"]);

    controller.beginComposition();
    controller.select("familiar-spreadsheet", "compact");
    controller.select("minimal-focus", "comfortable");
    expect(controller.getSnapshot().selection).toEqual(DEFAULT_APPEARANCE_SELECTION);
    expect(controller.getSnapshot().pendingSelection).toEqual({ profileId: "minimal-focus", density: "comfortable" });
    expect(applied).toEqual(["tachiko/compact"]);
    expect(writes).toEqual([]);

    const afterComposition = controller.endComposition();
    expect(afterComposition.selection).toEqual({ profileId: "minimal-focus", density: "comfortable" });
    expect(afterComposition.pendingSelection).toBeNull();
    expect(applied).toEqual(["tachiko/compact", "minimal-focus/comfortable"]);
    expect(writes).toEqual(['{"schemaVersion":1,"profileId":"minimal-focus","density":"comfortable"}']);
  });

  it("cancels a queued change when the latest request returns to the current selection", () => {
    const writes: string[] = [];
    const applied: string[] = [];
    const controller = createAppearancePreferenceController({ read: () => null, write: (value) => writes.push(value) },
      (selection) => applied.push(selection.profileId));
    controller.beginComposition();
    controller.select("minimal-focus", "compact");
    controller.select("tachiko", "compact");

    expect(controller.endComposition().selection).toEqual(DEFAULT_APPEARANCE_SELECTION);
    expect(applied).toEqual(["tachiko"]);
    expect(writes).toEqual([]);
  });

  it("rejects unsupported runtime choices without changing state", () => {
    const controller = createAppearancePreferenceController(memoryPort().port, () => {});
    expect(() => controller.select("custom" as never, "compact")).toThrow(RangeError);
    expect(controller.getSnapshot().selection).toEqual(DEFAULT_APPEARANCE_SELECTION);
  });
});
