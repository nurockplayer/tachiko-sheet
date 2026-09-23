import { useEffect, useId, useRef, useState } from "react";

import type {
  AppearanceDensity,
  AppearancePreferenceSnapshot,
  AppearanceProfileId,
  AppearanceSelection,
} from "../application/appearance-preference.js";
import { APPEARANCE_PROFILE_IDS } from "../application/appearance-preference.js";
import "./appearance-selector.css";

export type AppearanceSelectorProps = Readonly<{
  preference: AppearancePreferenceSnapshot;
  onSelectProfile: (profileId: AppearanceProfileId) => AppearancePreferenceSnapshot;
  onSelectDensity: (density: AppearanceDensity) => AppearancePreferenceSnapshot;
}>;

const PROFILE_LABELS: Readonly<Record<AppearanceProfileId, string>> = Object.freeze({
  tachiko: "Tachiko",
  "familiar-spreadsheet": "Familiar Spreadsheet",
  "minimal-focus": "Minimal-Focus",
});

const DENSITIES: readonly Readonly<{ id: AppearanceDensity; label: string }>[] = Object.freeze([
  Object.freeze({ id: "compact", label: "Compact" }),
  Object.freeze({ id: "comfortable", label: "Comfortable" }),
]);

/** Application-scoped, controlled appearance preference popover. */
export function AppearanceSelector({ preference, onSelectProfile, onSelectDensity }: AppearanceSelectorProps) {
  const [open, setOpen] = useState(false);
  const [pendingPresentation, setPendingPresentation] = useState<AppearanceSelection | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  const dialogId = `appearance-dialog-${id}`;
  const profileGroupName = `appearance-profile-${id}`;
  const densityGroupName = `appearance-density-${id}`;
  const selection = pendingPresentation ?? preference.pendingSelection ?? preference.selection;

  useEffect(() => {
    if (
      pendingPresentation !== null &&
      preference.pendingSelection === null &&
      preference.selection.profileId === pendingPresentation.profileId &&
      preference.selection.density === pendingPresentation.density
    ) {
      setPendingPresentation(null);
    }
  }, [pendingPresentation, preference]);

  const syncPendingPresentation = (snapshot: AppearancePreferenceSnapshot): void => {
    setPendingPresentation(snapshot.pendingSelection);
  };

  const closeAndReturnFocus = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onDocumentKeyDown = (event: globalThis.KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        event.isComposing ||
        event.keyCode === 229
      ) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("keydown", onDocumentKeyDown);
    return () => document.removeEventListener("keydown", onDocumentKeyDown);
  }, [open]);

  return (
    <div className="ts-appearance-selector">
      <button
        ref={triggerRef}
        type="button"
        className="ts-button ts-appearance-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={dialogId}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        Appearance
      </button>

      <section
        id={dialogId}
        className="ts-appearance-popover"
        role="dialog"
        aria-modal="false"
        aria-labelledby={`${dialogId}-title`}
        hidden={!open}
      >
        <header className="ts-appearance-popover__header">
          <h2 id={`${dialogId}-title`}>Appearance</h2>
          <button type="button" className="ts-button ts-button--ghost ts-appearance-close" onClick={closeAndReturnFocus}>
            Close
          </button>
        </header>

        <p className="ts-appearance-description">
          For this browser on this device.<br />
          Your work and saved copies stay unchanged.
        </p>

        <fieldset className="ts-appearance-group ts-appearance-group--profiles">
          <legend>Interface profile</legend>
          <div className="ts-appearance-profile-options">
            {APPEARANCE_PROFILE_IDS.map((profileId) => (
              <label
                className={`ts-appearance-profile-option${selection.profileId === profileId ? " ts-appearance-profile-option--selected" : ""}`}
                key={profileId}
              >
                <input
                  type="radio"
                  name={profileGroupName}
                  value={profileId}
                  checked={selection.profileId === profileId}
                  onChange={() => syncPendingPresentation(onSelectProfile(profileId))}
                />
                <span>{PROFILE_LABELS[profileId]}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="ts-appearance-group ts-appearance-group--density">
          <legend>Density</legend>
          <div className="ts-appearance-density-options">
            {DENSITIES.map(({ id: density, label }) => (
              <label
                className={`ts-appearance-density-option${selection.density === density ? " ts-appearance-density-option--selected" : ""}`}
                key={density}
              >
                <input
                  type="radio"
                  name={densityGroupName}
                  value={density}
                  checked={selection.density === density}
                  onChange={() => syncPendingPresentation(onSelectDensity(density))}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <p className="ts-appearance-footnote">
          Changes appearance only. No workbook save.<br />
          Escape closes and returns to Appearance.
        </p>

        {preference.notice === "invalid-preference" && (
          <p className="ts-appearance-notice" role="status" aria-live="polite">
            Saved appearance could not be loaded. Using Tachiko for this session.
          </p>
        )}
        {preference.notice === "preference-unavailable" && (
          <p className="ts-appearance-notice" role="status" aria-live="polite">
            Saved appearance could not be loaded. Using Tachiko for this session.
          </p>
        )}
        {preference.notSaved && (
          <p className="ts-appearance-notice ts-appearance-notice--failure" role="status" aria-live="polite">
            Appearance changed for this session, but could not be saved.
          </p>
        )}
      </section>
    </div>
  );
}
