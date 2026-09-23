import { describe, expect, it } from "vitest";
import {
  APPEARANCE_PROFILE_IDS as controllerProfileIds,
  DEFAULT_APPEARANCE_CHOICE,
  createAppearancePreferenceController,
  type AppearanceChoice,
  type RawAppearancePreferencePort,
} from "./appearance-preference.js";
import { APPEARANCE_PROFILE_IDS as modelProfileIds } from "./appearance-model.js";
import { TACHIKO_COMPACT_PORCELAIN_PROFILE } from "../ui/interface-profile/profile.js";

const v1 = (profileId = "familiar-spreadsheet", density = "comfortable") =>
  JSON.stringify({ schemaVersion: 1, profileId, density });
const v2BuiltIn = (profileId = "minimal-focus", density = "comfortable") =>
  JSON.stringify({ schemaVersion: 2, kind: "built-in", profileId, density });

function memoryPort(v2: string | null = null, legacy: string | null = null) {
  let currentV2 = v2;
  const writes: string[] = [];
  const port: RawAppearancePreferencePort = {
    readV2: () => currentV2,
    readLegacyV1: () => legacy,
    writeV2: (next) => { writes.push(next); currentV2 = next; },
  };
  return { port, writes, readV2: () => currentV2 };
}

describe("application appearance preference", () => {
  it("uses Tachiko/compact for missing records without writing", () => {
    const storage = memoryPort();
    const applied: AppearanceChoice[] = [];
    const controller = createAppearancePreferenceController(storage.port, (choice) => applied.push(choice));

    expect(controller.getSnapshot().selection).toEqual(DEFAULT_APPEARANCE_CHOICE);
    expect(controller.getSnapshot().notice).toBeNull();
    expect(applied).toEqual([DEFAULT_APPEARANCE_CHOICE]);
    expect(storage.writes).toEqual([]);
  });

  it("loads exact v2 without rewriting it and prefers it over legacy v1", () => {
    const storage = memoryPort(v2BuiltIn(), v1());
    const controller = createAppearancePreferenceController(storage.port, () => {});

    expect(controller.getSnapshot().selection).toEqual({ kind: "built-in", profileId: "minimal-focus", density: "comfortable" });
    expect(controller.getSnapshot().notice).toBeNull();
    expect(storage.writes).toEqual([]);
  });

  it("keeps the model identifiers available through the controller exports", () => {
    expect(controllerProfileIds).toBe(modelProfileIds);
  });

  it("reads exact legacy v1 only when v2 is missing and does not migrate on startup", () => {
    const storage = memoryPort(null, v1());
    const applied: AppearanceChoice[] = [];
    const controller = createAppearancePreferenceController(storage.port, (choice) => applied.push(choice));
    expect(controller.getSnapshot().selection).toEqual({ kind: "built-in", profileId: "familiar-spreadsheet", density: "comfortable" });
    expect(applied).toHaveLength(1);
    expect(storage.writes).toEqual([]);
  });

  it("discloses invalid legacy data without treating it as a storage failure", () => {
    const controller = createAppearancePreferenceController(memoryPort(null, "{").port, () => {});
    expect(controller.getSnapshot().selection).toEqual(DEFAULT_APPEARANCE_CHOICE);
    expect(controller.getSnapshot().notice).toBe("invalid-preference");
  });

  it.each([
    ["malformed JSON", "{"],
    ["unsupported schema", JSON.stringify({ schemaVersion: 3, kind: "built-in", profileId: "tachiko", density: "compact" })],
    ["unknown profile", v2BuiltIn("custom", "compact")],
    ["extra field", JSON.stringify({ schemaVersion: 2, kind: "built-in", profileId: "tachiko", density: "compact", extra: 1 })],
  ])("falls back to Tachiko and does not consult legacy after corrupt v2 (%s)", (_label, badV2) => {
    const storage = memoryPort(badV2, v1());
    const controller = createAppearancePreferenceController(storage.port, () => {});
    expect(controller.getSnapshot().selection).toEqual(DEFAULT_APPEARANCE_CHOICE);
    expect(controller.getSnapshot().notice).toBe("invalid-preference");
    expect(storage.writes).toEqual([]);
  });

  it("reports unavailable storage and still applies the fallback", () => {
    const applied: AppearanceChoice[] = [];
    const controller = createAppearancePreferenceController({
      readV2: () => { throw new Error("storage disabled"); },
      readLegacyV1: () => v1(),
      writeV2: () => { throw new Error("storage disabled"); },
    }, (choice) => applied.push(choice));
    expect(controller.getSnapshot().selection).toEqual(DEFAULT_APPEARANCE_CHOICE);
    expect(controller.getSnapshot().notice).toBe("preference-unavailable");
    expect(applied).toEqual([DEFAULT_APPEARANCE_CHOICE]);
  });

  it("writes v2 after the presentation callback and retains the choice on write failure", () => {
    const events: string[] = [];
    const controller = createAppearancePreferenceController({
      readV2: () => null,
      readLegacyV1: () => null,
      writeV2: (value) => events.push(`write:${value}`),
    }, (choice) => events.push(choice.kind === "built-in"
      ? `apply:${choice.kind}/${choice.profileId}/${choice.density}`
      : `apply:${choice.kind}/${choice.profile.name}/${choice.profile.density}`));

    controller.selectBuiltIn("minimal-focus", "comfortable");
    expect(events).toEqual([
      "apply:built-in/tachiko/compact",
      "apply:built-in/minimal-focus/comfortable",
      `write:${v2BuiltIn()}`,
    ]);
    expect(controller.getSnapshot().notSaved).toBe(false);

    const failed = createAppearancePreferenceController({
      readV2: () => null,
      readLegacyV1: () => null,
      writeV2: () => { throw new Error("quota"); },
    }, () => {});
    failed.selectBuiltIn("familiar-spreadsheet", "compact");
    expect(failed.getSnapshot().selection).toEqual({ kind: "built-in", profileId: "familiar-spreadsheet", density: "compact" });
    expect(failed.getSnapshot().notSaved).toBe(true);
  });

  it("keeps notSaved sticky after quota failure and clears it after a successful same-choice retry", () => {
    let failWrite = true;
    const writes: string[] = [];
    const controller = createAppearancePreferenceController({
      readV2: () => null,
      readLegacyV1: () => null,
      writeV2: (value) => {
        if (failWrite) throw new Error("quota");
        writes.push(value);
      },
    }, () => {});

    controller.selectBuiltIn("familiar-spreadsheet", "compact");
    expect(controller.getSnapshot().notSaved).toBe(true);
    expect(controller.getSnapshot().selection).toEqual({ kind: "built-in", profileId: "familiar-spreadsheet", density: "compact" });

    failWrite = false;
    controller.selectBuiltIn("familiar-spreadsheet", "compact");
    expect(controller.getSnapshot().notSaved).toBe(false);
    expect(writes).toEqual([JSON.stringify({ schemaVersion: 2, kind: "built-in", profileId: "familiar-spreadsheet", density: "compact" })]);
  });

  it.each([
    ["corrupt preference", (): string | null => "{", "invalid-preference"],
    ["unavailable storage", (): string | null => { throw new Error("blocked origin"); }, "preference-unavailable"],
  ] as const)("replaces the %s fallback notice after a failed choice save and retry", (_label, readV2, initialNotice) => {
    let failWrite = true;
    const writes: string[] = [];
    const controller = createAppearancePreferenceController({
      readV2,
      readLegacyV1: () => null,
      writeV2: (value) => {
        if (failWrite) throw new Error("quota");
        writes.push(value);
      },
    }, () => {});

    expect(controller.getSnapshot().selection).toEqual(DEFAULT_APPEARANCE_CHOICE);
    expect(controller.getSnapshot().notice).toBe(initialNotice);
    controller.selectBuiltIn("familiar-spreadsheet", "compact");
    expect(controller.getSnapshot().selection).toEqual({ kind: "built-in", profileId: "familiar-spreadsheet", density: "compact" });
    expect(controller.getSnapshot().notice).toBeNull();
    expect(controller.getSnapshot().notSaved).toBe(true);

    failWrite = false;
    controller.selectBuiltIn("familiar-spreadsheet", "compact");
    expect(controller.getSnapshot().notice).toBeNull();
    expect(controller.getSnapshot().notSaved).toBe(false);
    expect(writes).toEqual([JSON.stringify({ schemaVersion: 2, kind: "built-in", profileId: "familiar-spreadsheet", density: "compact" })]);
  });

  it("leaves active choice and persistence unchanged if presentation rejects a choice", () => {
    const storage = memoryPort();
    const controller = createAppearancePreferenceController(storage.port, (choice) => {
      if (choice.kind === "built-in" && choice.profileId === "minimal-focus") throw new Error("presentation failed");
    });
    expect(() => controller.selectBuiltIn("minimal-focus", "compact")).toThrow("presentation failed");
    expect(controller.getSnapshot().selection).toEqual(DEFAULT_APPEARANCE_CHOICE);
    expect(storage.writes).toEqual([]);
  });

  it("freshly admits imported choices and keeps density inside the complete manifest", () => {
    const storage = memoryPort();
    const applied: AppearanceChoice[] = [];
    const controller = createAppearancePreferenceController(storage.port, (choice) => applied.push(choice));
    controller.selectImported(TACHIKO_COMPACT_PORCELAIN_PROFILE);
    const imported = controller.getSnapshot().selection;
    expect(imported.kind).toBe("imported");
    if (imported.kind !== "imported") throw new Error("expected imported choice");
    expect(imported.profile.density).toBe("compact");
    controller.selectDensity("comfortable");
    const changed = controller.getSnapshot().selection;
    expect(changed.kind).toBe("imported");
    if (changed.kind !== "imported") throw new Error("expected imported choice");
    expect(changed.profile.density).toBe("comfortable");
    expect(JSON.parse(storage.readV2() ?? "{}").profile.density).toBe("comfortable");
    expect(applied.at(-1)).toEqual(changed);
  });

  it("queues only the latest full choice during IME composition", () => {
    const writes: string[] = [];
    const applied: string[] = [];
    const controller = createAppearancePreferenceController({
      readV2: () => null,
      readLegacyV1: () => null,
      writeV2: (value) => writes.push(value),
    }, (choice) => applied.push(choice.kind === "built-in" ? `${choice.profileId}/${choice.density}` : `${choice.profile.name}/${choice.profile.density}`));
    controller.beginComposition();
    controller.selectBuiltIn("familiar-spreadsheet", "compact");
    controller.selectImported(TACHIKO_COMPACT_PORCELAIN_PROFILE);
    controller.selectDensity("comfortable");
    expect(controller.getSnapshot().selection).toEqual(DEFAULT_APPEARANCE_CHOICE);
    expect(controller.getSnapshot().pendingSelection).toMatchObject({ kind: "imported", profile: { density: "comfortable" } });
    expect(applied).toEqual(["tachiko/compact"]);
    expect(writes).toEqual([]);
    controller.endComposition();
    expect(applied.at(-1)).toBe("Tachiko/comfortable");
    expect(writes).toHaveLength(1);
  });

  it("cancels a queued change when the latest IME choice returns to the active choice", () => {
    const writes: string[] = [];
    const applied: AppearanceChoice[] = [];
    const controller = createAppearancePreferenceController({
      readV2: () => null,
      readLegacyV1: () => null,
      writeV2: (value) => writes.push(value),
    }, (choice) => applied.push(choice));

    controller.beginComposition();
    controller.selectBuiltIn("minimal-focus", "comfortable");
    controller.selectBuiltIn("tachiko", "compact");
    expect(controller.getSnapshot().pendingSelection).toBeNull();
    expect(controller.endComposition().selection).toEqual(DEFAULT_APPEARANCE_CHOICE);
    expect(applied).toEqual([DEFAULT_APPEARANCE_CHOICE]);
    expect(writes).toEqual([]);
  });

  it("rejects invalid runtime built-in choices without mutating active or queued state", () => {
    const storage = memoryPort();
    const controller = createAppearancePreferenceController(storage.port, () => {});
    expect(() => controller.selectBuiltIn("custom" as never, "compact")).toThrow(TypeError);
    expect(controller.getSnapshot().selection).toEqual(DEFAULT_APPEARANCE_CHOICE);
    expect(controller.getSnapshot().pendingSelection).toBeNull();
    expect(storage.writes).toEqual([]);

    controller.beginComposition();
    expect(() => controller.selectBuiltIn("tachiko", "spacious" as never)).toThrow(TypeError);
    expect(controller.getSnapshot().pendingSelection).toBeNull();
    expect(controller.getSnapshot().selection).toEqual(DEFAULT_APPEARANCE_CHOICE);
  });
});
