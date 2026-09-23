/** Shared pure identifiers and value types for application appearance choice. */
import type { InterfaceProfileV1 } from "./interface-profile-contract.js";

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

/** The one active or queued appearance, with imported data kept complete. */
export type AppearanceChoice =
  | Readonly<{ kind: "built-in"; profileId: AppearanceProfileId; density: AppearanceDensity }>
  | Readonly<{ kind: "imported"; profile: InterfaceProfileV1 }>;

export const toAppearanceChoice = (selection: AppearanceSelection): AppearanceChoice =>
  Object.freeze({ kind: "built-in", profileId: selection.profileId, density: selection.density });

export const appearanceChoiceDensity = (choice: AppearanceChoice): AppearanceDensity =>
  choice.kind === "built-in" ? choice.density : choice.profile.density;

export const sameAppearanceChoice = (left: AppearanceChoice, right: AppearanceChoice): boolean => {
  if (left.kind !== right.kind) return false;
  if (left.kind === "built-in" && right.kind === "built-in") {
    return left.profileId === right.profileId && left.density === right.density;
  }
  return left.kind === "imported" && right.kind === "imported" &&
    JSON.stringify(left.profile) === JSON.stringify(right.profile);
};
