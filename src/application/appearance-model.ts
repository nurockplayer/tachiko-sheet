/** Shared pure identifiers and value types for application appearance choice. */
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
