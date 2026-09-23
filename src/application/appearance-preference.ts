/**
 * Local application appearance choice. This controller deliberately knows
 * nothing about React, the DOM, workbook state, or the host persistence API.
 */

export const APPEARANCE_PROFILE_IDS = Object.freeze([
  "tachiko",
  "familiar-spreadsheet",
  "minimal-focus",
] as const);

export type AppearanceProfileId = (typeof APPEARANCE_PROFILE_IDS)[number];
export type AppearanceDensity = "compact" | "comfortable";

export type AppearanceSelection = Readonly<{
  profileId: AppearanceProfileId;
  density: AppearanceDensity;
}>;

export type AppearancePreferenceNotice = "invalid-preference" | "preference-unavailable";

export type AppearancePreferenceSnapshot = Readonly<{
  /** The appearance currently applied to this session. */
  selection: AppearanceSelection;
  /** A selection queued during IME composition, if any. */
  pendingSelection: AppearanceSelection | null;
  /** Why a stored choice could not be loaded; cleared when a different session choice is applied. */
  notice: AppearancePreferenceNotice | null;
  /** Sticky after a failed save until a later successful save. */
  notSaved: boolean;
  composing: boolean;
}>;

export interface RawAppearancePreferencePort {
  read(): string | null;
  write(value: string): void;
}

export type ApplyAppearance = (selection: AppearanceSelection) => void;

export type AppearancePreferenceController = Readonly<{
  getSnapshot(): AppearancePreferenceSnapshot;
  select(profileId: AppearanceProfileId, density: AppearanceDensity): AppearancePreferenceSnapshot;
  beginComposition(): void;
  endComposition(): AppearancePreferenceSnapshot;
}>;

export const DEFAULT_APPEARANCE_SELECTION: AppearanceSelection = Object.freeze({
  profileId: "tachiko",
  density: "compact",
});

const isProfileId = (value: unknown): value is AppearanceProfileId =>
  (APPEARANCE_PROFILE_IDS as readonly unknown[]).includes(value);

const isDensity = (value: unknown): value is AppearanceDensity =>
  value === "compact" || value === "comfortable";

const freezeSelection = (profileId: AppearanceProfileId, density: AppearanceDensity): AppearanceSelection =>
  Object.freeze({ profileId, density });

function decodePreference(raw: string): AppearanceSelection {
  const value: unknown = JSON.parse(raw);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Appearance preference must be an object.");
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Appearance preference must be a plain object.");
  }

  const keys = Reflect.ownKeys(value);
  const expected = ["schemaVersion", "profileId", "density"];
  if (keys.length !== expected.length || keys.some((key) => typeof key !== "string" || !expected.includes(key))) {
    throw new TypeError("Appearance preference has unexpected fields.");
  }

  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) {
      throw new TypeError("Appearance preference fields must be data properties.");
    }
  }

  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1 || !isProfileId(record.profileId) || !isDensity(record.density)) {
    throw new TypeError("Appearance preference contains an unsupported value.");
  }
  return freezeSelection(record.profileId, record.density);
}

function encodePreference(selection: AppearanceSelection): string {
  // Keep this record intentionally exact and separate from workbook storage.
  return JSON.stringify({
    schemaVersion: 1,
    profileId: selection.profileId,
    density: selection.density,
  });
}

/**
 * Load and apply the local preference immediately. Missing preferences use
 * Tachiko/compact without creating a storage record.
 */
export function createAppearancePreferenceController(
  port: RawAppearancePreferencePort,
  applyAppearance: ApplyAppearance,
): AppearancePreferenceController {
  let selection = DEFAULT_APPEARANCE_SELECTION;
  let pendingSelection: AppearanceSelection | null = null;
  let notice: AppearancePreferenceNotice | null = null;
  let notSaved = false;
  let composing = false;

  let raw: string | null;
  try {
    raw = port.read();
  } catch {
    // Preference loading must not block the sheet. The fallback stays local.
    raw = null;
    notice = "preference-unavailable";
  }
  if (raw !== null) {
    try {
      selection = decodePreference(raw);
    } catch {
      notice = "invalid-preference";
    }
  }

  applyAppearance(selection);

  const getSnapshot = (): AppearancePreferenceSnapshot => Object.freeze({
    selection,
    pendingSelection,
    notice,
    notSaved,
    composing,
  });

  const commit = (next: AppearanceSelection): AppearancePreferenceSnapshot => {
    if (next.profileId === selection.profileId && next.density === selection.density) {
      pendingSelection = null;
      if (notSaved || notice !== null) {
        try {
          port.write(encodePreference(selection));
          notSaved = false;
          notice = null;
        } catch {
          notSaved = true;
        }
      }
      return getSnapshot();
    }

    selection = next;
    pendingSelection = null;
    // The load fallback no longer describes the active session after a new
    // choice is applied, even when persistence of that choice fails.
    notice = null;
    // Apply first so a failed write never rolls back the user's session choice.
    applyAppearance(selection);
    try {
      port.write(encodePreference(selection));
      notSaved = false;
      notice = null;
    } catch {
      notSaved = true;
    }
    return getSnapshot();
  };

  return Object.freeze({
    getSnapshot,
    select(profileId: AppearanceProfileId, density: AppearanceDensity): AppearancePreferenceSnapshot {
      if (!isProfileId(profileId) || !isDensity(density)) {
        throw new RangeError("Unsupported appearance profile or density.");
      }
      const next = freezeSelection(profileId, density);
      if (composing) {
        pendingSelection = next.profileId === selection.profileId && next.density === selection.density
          ? null
          : next;
        return getSnapshot();
      }
      return commit(next);
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
