/**
 * Local application appearance choice. This controller deliberately knows
 * nothing about React, the DOM, workbook state, or the host persistence API.
 */
import {
  APPEARANCE_PROFILE_IDS,
  appearanceChoiceDensity,
  sameAppearanceChoice,
  toAppearanceChoice,
  type AppearanceChoice,
  type AppearanceDensity,
  type AppearanceProfileId,
  type AppearanceSelection,
} from "./appearance-model.js";
import {
  decodeAppearancePreferenceV2,
  decodeLegacyAppearancePreferenceV1,
  encodeAppearancePreferenceV2,
  type AdmittedAppearancePreferenceV2,
} from "./appearance-preference-codec.js";
import type { InterfaceProfileV1 } from "./interface-profile-contract.js";

export { APPEARANCE_PROFILE_IDS };
export type { AppearanceChoice, AppearanceDensity, AppearanceProfileId, AppearanceSelection };

export type AppearancePreferenceNotice = "invalid-preference" | "preference-unavailable";

export type AppearancePreferenceSnapshot = Readonly<{
  /** The appearance currently applied to this session. */
  selection: AppearanceChoice;
  /** A complete choice queued during IME composition, if any. */
  pendingSelection: AppearanceChoice | null;
  /** Why a stored choice could not be loaded; cleared when a different session choice is applied. */
  notice: AppearancePreferenceNotice | null;
  /** Sticky after a failed save until a later successful save. */
  notSaved: boolean;
  composing: boolean;
}>;

export interface RawAppearancePreferencePort {
  readV2(): string | null;
  readLegacyV1(): string | null;
  writeV2(value: string): void;
}

export type ApplyAppearance = (choice: AppearanceChoice) => void;

export type AppearancePreferenceController = Readonly<{
  getSnapshot(): AppearancePreferenceSnapshot;
  selectBuiltIn(profileId: AppearanceProfileId, density: AppearanceDensity): AppearancePreferenceSnapshot;
  selectDensity(density: AppearanceDensity): AppearancePreferenceSnapshot;
  selectImported(profile: InterfaceProfileV1): AppearancePreferenceSnapshot;
  beginComposition(): void;
  endComposition(): AppearancePreferenceSnapshot;
}>;

export const DEFAULT_APPEARANCE_CHOICE: AppearanceChoice = Object.freeze({
  kind: "built-in",
  profileId: "tachiko",
  density: "compact",
});
export const DEFAULT_APPEARANCE_SELECTION: AppearanceSelection = Object.freeze({
  profileId: "tachiko",
  density: "compact",
});

function choiceFromPreference(preference: AdmittedAppearancePreferenceV2): AppearanceChoice {
  return preference.kind === "built-in"
    ? Object.freeze({ kind: "built-in", profileId: preference.profileId, density: preference.density })
    : Object.freeze({ kind: "imported", profile: preference.profile });
}

function legacyChoice(raw: string): AppearanceChoice {
  const decoded = decodeLegacyAppearancePreferenceV1(raw);
  if (!decoded.ok) throw new TypeError(decoded.errors[0]?.message ?? "Invalid legacy appearance preference.");
  return toAppearanceChoice(decoded.value);
}

function prepareChoice(choice: AppearanceChoice): Readonly<{ choice: AppearanceChoice; raw: string }> {
  const encoded = encodeAppearancePreferenceV2({ schemaVersion: 2, ...choice });
  if (!encoded.ok) throw new TypeError(encoded.errors[0]?.message ?? "Invalid appearance choice.");
  return Object.freeze({ choice: choiceFromPreference(encoded.value.preference), raw: encoded.value.raw });
}

function withDensity(choice: AppearanceChoice, density: AppearanceDensity): AppearanceChoice {
  if (choice.kind === "built-in") {
    return Object.freeze({ kind: "built-in", profileId: choice.profileId, density });
  }
  return Object.freeze({ kind: "imported", profile: Object.freeze({ ...choice.profile, density }) });
}

/**
 * Load and apply the local preference immediately. Missing preferences use
 * Tachiko/compact without creating a storage record or migrating legacy data.
 */
export function createAppearancePreferenceController(
  port: RawAppearancePreferencePort,
  applyAppearance: ApplyAppearance,
): AppearancePreferenceController {
  let selection = DEFAULT_APPEARANCE_CHOICE;
  let pendingSelection: AppearanceChoice | null = null;
  let notice: AppearancePreferenceNotice | null = null;
  let notSaved = false;
  let composing = false;
  let currentRaw: string | null = null;

  let rawV2: string | null = null;
  try { rawV2 = port.readV2(); } catch { notice = "preference-unavailable"; }
  if (notice === null && rawV2 !== null) {
    const decoded = decodeAppearancePreferenceV2(rawV2);
    if (!decoded.ok) notice = "invalid-preference";
    else {
      try {
        const prepared = prepareChoice(choiceFromPreference(decoded.value));
        selection = prepared.choice;
        currentRaw = prepared.raw;
      } catch {
        notice = "invalid-preference";
      }
    }
  } else if (notice === null) {
    let rawLegacy: string | null = null;
    try { rawLegacy = port.readLegacyV1(); } catch { notice = "preference-unavailable"; }
    if (notice === null && rawLegacy !== null) {
      try {
        selection = legacyChoice(rawLegacy);
        currentRaw = prepareChoice(selection).raw;
      } catch {
        notice = "invalid-preference";
      }
    }
  }

  try {
    applyAppearance(selection);
  } catch {
    // A stored choice that cannot be presented is not made active.
    selection = DEFAULT_APPEARANCE_CHOICE;
    currentRaw = null;
    notice = "invalid-preference";
    try { applyAppearance(selection); } catch { /* Boot must remain available. */ }
  }

  const getSnapshot = (): AppearancePreferenceSnapshot => Object.freeze({
    selection,
    pendingSelection,
    notice,
    notSaved,
    composing,
  });

  const commit = (candidate: AppearanceChoice): AppearancePreferenceSnapshot => {
    const prepared = prepareChoice(candidate);
    const next = prepared.choice;
    if (sameAppearanceChoice(next, selection)) {
      pendingSelection = null;
      if (notSaved || notice !== null) {
        try {
          port.writeV2(currentRaw ?? prepared.raw);
          currentRaw = currentRaw ?? prepared.raw;
          notSaved = false;
          notice = null;
        } catch {
          notSaved = true;
        }
      }
      return getSnapshot();
    }

    // Presentation must succeed before active state or persistence changes.
    applyAppearance(next);
    selection = next;
    currentRaw = prepared.raw;
    pendingSelection = null;
    notice = null;
    try {
      port.writeV2(prepared.raw);
      notSaved = false;
    } catch {
      notSaved = true;
    }
    return getSnapshot();
  };

  const queueOrCommit = (candidate: AppearanceChoice): AppearancePreferenceSnapshot => {
    const prepared = prepareChoice(candidate);
    const next = prepared.choice;
    if (composing) {
      pendingSelection = sameAppearanceChoice(next, selection) ? null : next;
      return getSnapshot();
    }
    return commit(next);
  };

  return Object.freeze({
    getSnapshot,
    selectBuiltIn(profileId: AppearanceProfileId, density: AppearanceDensity): AppearancePreferenceSnapshot {
      return queueOrCommit(Object.freeze({ kind: "built-in", profileId, density }));
    },
    selectDensity(density: AppearanceDensity): AppearancePreferenceSnapshot {
      return queueOrCommit(withDensity(pendingSelection ?? selection, density));
    },
    selectImported(profile: InterfaceProfileV1): AppearancePreferenceSnapshot {
      return queueOrCommit(Object.freeze({ kind: "imported", profile }));
    },
    beginComposition(): void {
      composing = true;
    },
    endComposition(): AppearancePreferenceSnapshot {
      composing = false;
      const queued = pendingSelection;
      return queued ? commit(queued) : getSnapshot();
    },
  });
}

export function appearanceDensity(choice: AppearanceChoice): AppearanceDensity {
  return appearanceChoiceDensity(choice);
}
