import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";

import { APPEARANCE_PROFILE_IDS, appearanceDensity } from "../application/appearance-preference.js";
import { encodeInterfaceProfileExport } from "../application/interface-profile-export.js";
import type { InterfaceProfileV1 } from "../application/interface-profile-contract.js";
import { requestInterfaceProfileDownload, stageInterfaceProfileFile } from "../host/interface-profile-files.js";
import { sameAppearanceChoice } from "../application/appearance-model.js";
import type {
  AppearanceChoice,
  AppearanceDensity,
  AppearancePreferenceSnapshot,
  AppearanceProfileId,
} from "../application/appearance-preference.js";
import { resolveBuiltInInterfaceProfile } from "./interface-profile/profile.js";
import "./appearance-selector.css";

export type AppearanceSelectorProps = Readonly<{
  preference: AppearancePreferenceSnapshot;
  onSelectProfile: (profileId: AppearanceProfileId) => AppearancePreferenceSnapshot;
  onSelectDensity: (density: AppearanceDensity) => AppearancePreferenceSnapshot;
  onSelectImported: (profile: InterfaceProfileV1) => AppearancePreferenceSnapshot;
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
export function AppearanceSelector({
  preference,
  onSelectProfile,
  onSelectDensity,
  onSelectImported,
}: AppearanceSelectorProps) {
  const [open, setOpen] = useState(false);
  const [pendingPresentation, setPendingPresentation] = useState<AppearanceChoice | null>(null);
  const [stagedProfile, setStagedProfile] = useState<InterfaceProfileV1 | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [readingFile, setReadingFile] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importButtonRef = useRef<HTMLButtonElement>(null);
  const importedRadioRef = useRef<HTMLInputElement>(null);
  const candidateCardRef = useRef<HTMLDivElement>(null);
  const rejectedStatusRef = useRef<HTMLDivElement>(null);
  const fileRequestGeneration = useRef(0);
  const focusAfterRender = useRef<"candidate" | "rejected" | "import" | "imported" | null>(null);
  const id = useId();
  const dialogId = `appearance-dialog-${id}`;
  const profileGroupName = `appearance-profile-${id}`;
  const densityGroupName = `appearance-density-${id}`;
  const selection = pendingPresentation ?? preference.pendingSelection ?? preference.selection;
  const activeChoice = preference.selection;
  const exportHasQueuedChoice = !sameAppearanceChoice(selection, activeChoice);
  const importedChoice = selection.kind === "imported"
    ? selection
    : activeChoice.kind === "imported" ? activeChoice : null;
  const selectedProfileId = selection.kind === "built-in" ? selection.profileId : null;
  const selectedDensity = appearanceDensity(selection);

  useEffect(() => {
    if (
      pendingPresentation !== null &&
      !preference.composing &&
      preference.pendingSelection === null &&
      sameAppearanceChoice(preference.selection, pendingPresentation)
    ) {
      setPendingPresentation(null);
    }
  }, [pendingPresentation, preference]);

  const syncPendingPresentation = (snapshot: AppearancePreferenceSnapshot): void => {
    setPendingPresentation(snapshot.pendingSelection);
    setExportMessage(null);
  };

  useEffect(() => {
    const target = focusAfterRender.current;
    if (target === "candidate" && stagedProfile) candidateCardRef.current?.focus();
    else if (target === "rejected" && importError) rejectedStatusRef.current?.focus();
    else if (target === "imported" && selection.kind === "imported") importedRadioRef.current?.focus();
    else if (target === "import") importButtonRef.current?.focus();
    else return;
    focusAfterRender.current = null;
  }, [stagedProfile, importError, selection]);

  useEffect(() => () => {
    fileRequestGeneration.current += 1;
  }, []);

  const onProfileFileChange = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const input = event.currentTarget;
    const file = input.files?.[0] ?? null;
    input.value = "";
    if (!file) return;

    const generation = ++fileRequestGeneration.current;
    setStagedProfile(null);
    setImportError(null);
    setExportMessage(null);
    setReadingFile(true);
    try {
      const result = await stageInterfaceProfileFile(file);
      if (generation !== fileRequestGeneration.current) return;
      if (result.ok) {
        focusAfterRender.current = "candidate";
        setStagedProfile(result.profile);
      } else if ("code" in result) {
        focusAfterRender.current = "rejected";
        setImportError(result.message);
      } else {
        focusAfterRender.current = "rejected";
        setImportError(result.errors[0]?.message ?? "The profile file could not be imported.");
      }
    } catch {
      if (generation === fileRequestGeneration.current) {
        focusAfterRender.current = "rejected";
        setImportError("The profile file could not be imported.");
      }
    } finally {
      if (generation === fileRequestGeneration.current) setReadingFile(false);
    }
  };

  const cancelStagedProfile = (): void => {
    fileRequestGeneration.current += 1;
    focusAfterRender.current = "import";
    setReadingFile(false);
    setStagedProfile(null);
    setImportError(null);
  };

  const applyStagedProfile = (): void => {
    if (!stagedProfile) return;
    try {
      const snapshot = onSelectImported(stagedProfile);
      focusAfterRender.current = "imported";
      syncPendingPresentation(snapshot);
      setStagedProfile(null);
      setImportError(null);
    } catch (error) {
      focusAfterRender.current = "rejected";
      setStagedProfile(null);
      setImportError(error instanceof Error ? error.message : "This profile could not be applied.");
    }
  };

  const exportSelectedProfile = (): void => {
    const activeChoice = preference.selection;
    const activeProfile = activeChoice.kind === "imported"
      ? activeChoice.profile
      : resolveBuiltInInterfaceProfile(activeChoice.profileId, activeChoice.density);
    if (activeProfile === null || ("ok" in activeProfile && !activeProfile.ok)) {
      setExportMessage("The selected profile could not be prepared for export.");
      return;
    }
    const profile = "ok" in activeProfile ? activeProfile.value.profile : activeProfile;
    const encoded = encodeInterfaceProfileExport(profile);
    if (!encoded.ok) {
      setExportMessage(encoded.errors[0]?.message ?? "The selected profile could not be prepared for export.");
      return;
    }
    const request = requestInterfaceProfileDownload(encoded);
    setExportMessage(request.ok
      ? `Download requested: ${request.filename}. Browser save completion is not reported.`
      : request.message);
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

        <div className="ts-appearance-content">
          <p className="ts-appearance-description">
            For this browser on this device.<br />
            Your work and saved copies stay unchanged.
          </p>

        <fieldset className="ts-appearance-group ts-appearance-group--profiles">
          <legend>Interface profile</legend>
          <div className="ts-appearance-profile-options">
            {APPEARANCE_PROFILE_IDS.map((profileId) => (
              <label
                className={`ts-appearance-profile-option${selectedProfileId === profileId ? " ts-appearance-profile-option--selected" : ""}`}
                key={profileId}
              >
              <input
                type="radio"
                  name={profileGroupName}
                  value={profileId}
                  checked={selectedProfileId === profileId}
                  onChange={() => syncPendingPresentation(onSelectProfile(profileId))}
                />
                <span>{PROFILE_LABELS[profileId]}</span>
              </label>
            ))}
            {importedChoice !== null && (
              <label className={`ts-appearance-profile-option ts-appearance-profile-option--imported${selectedProfileId === null ? " ts-appearance-profile-option--selected" : ""}`}>
                <input
                  type="radio"
                  name={profileGroupName}
                  value="imported"
                  checked={selectedProfileId === null}
                  ref={importedRadioRef}
                  onChange={() => syncPendingPresentation(onSelectImported(importedChoice.profile))}
                />
                <span className="ts-appearance-imported-choice">
                  <span className="ts-appearance-imported-badge">Imported</span>
                  <bdi dir="auto">{importedChoice.profile.name}</bdi>
                </span>
              </label>
            )}
          </div>
        </fieldset>

        <section className="ts-appearance-custom" aria-labelledby={`${dialogId}-custom-title`}>
          <h3 id={`${dialogId}-custom-title`}>Custom profile</h3>
          <p className="ts-appearance-custom-description">
            A local .tachiko-profile.json file, up to 32 KiB. Review it before applying.
          </p>
          <input
            ref={fileInputRef}
            className="ts-appearance-file-input"
            type="file"
            tabIndex={-1}
            accept=".tachiko-profile.json,application/json,.json"
            aria-label="Choose a local profile file"
            onChange={(event) => { void onProfileFileChange(event); }}
          />
          <div className="ts-appearance-custom-actions">
            <button ref={importButtonRef} type="button" className="ts-button" onClick={() => fileInputRef.current?.click()}>
              {readingFile ? "Choose another file…" : "Import profile…"}
            </button>
            <button type="button" className="ts-button" onClick={exportSelectedProfile}>
              {exportHasQueuedChoice ? "Export active profile…" : "Export selected profile…"}
            </button>
          </div>
          {exportHasQueuedChoice && <p className="ts-appearance-inline-status">The queued choice applies after editing; export uses the active profile.</p>}

          {readingFile && <p className="ts-appearance-inline-status" role="status" aria-live="polite">Reading profile file…</p>}
          {stagedProfile && (
            <div ref={candidateCardRef} className="ts-appearance-candidate" aria-live="polite" tabIndex={-1}>
              <div className="ts-appearance-candidate__name">
                <span className="ts-appearance-imported-badge">Imported</span>
                <bdi dir="auto">{stagedProfile.name}</bdi>
              </div>
              <p className="ts-appearance-candidate__metadata">Valid v1 profile · {stagedProfile.density === "compact" ? "Compact" : "Comfortable"} · Light</p>
              <p className="ts-appearance-candidate__hint">Ready to apply. Current profile stays {activeChoice.kind === "built-in" ? PROFILE_LABELS[activeChoice.profileId] : <bdi dir="auto">{activeChoice.profile.name}</bdi>} until you choose Apply.</p>
              <div className="ts-appearance-candidate__actions">
                <button type="button" className="ts-button ts-button--primary" onClick={applyStagedProfile}>Apply profile</button>
                <button type="button" className="ts-button" onClick={cancelStagedProfile}>Cancel</button>
              </div>
            </div>
          )}
          {importError && (
            <div ref={rejectedStatusRef} className="ts-appearance-notice ts-appearance-notice--rejected" role="alert" tabIndex={-1}>
              <strong>Profile not imported</strong>
              <span>{importError}</span>
              <span>{activeChoice.kind === "built-in" ? PROFILE_LABELS[activeChoice.profileId] : <bdi dir="auto">{activeChoice.profile.name}</bdi>} is still active. Your sheet and draft are unchanged.</span>
            </div>
          )}
          {preference.notSaved && activeChoice.kind === "imported" && (
            <div className="ts-appearance-notice ts-appearance-notice--failure" role="status" aria-live="polite">
              <strong>Appearance could not be saved</strong>
              <span><bdi dir="auto">“{activeChoice.profile.name}”</bdi> is active for this session. It may reset when this browser is reopened.</span>
            </div>
          )}
          {exportMessage && <p className="ts-appearance-export-status" role="status" aria-live="polite">{exportMessage}</p>}
        </section>

        <fieldset className="ts-appearance-group ts-appearance-group--density">
          <legend>Density</legend>
          <div className="ts-appearance-density-options">
            {DENSITIES.map(({ id: density, label }) => (
              <label
                className={`ts-appearance-density-option${selectedDensity === density ? " ts-appearance-density-option--selected" : ""}`}
                key={density}
              >
                <input
                  type="radio"
                  name={densityGroupName}
                  value={density}
                  checked={selectedDensity === density}
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
        {activeChoice.kind === "imported" && (
          <p className="ts-appearance-export-note">Export requests normalized v1 JSON for the active profile. It contains no workbook data.</p>
        )}

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
        {preference.notSaved && activeChoice.kind !== "imported" && (
          <p className="ts-appearance-notice ts-appearance-notice--failure" role="status" aria-live="polite">
            Appearance changed for this session, but could not be saved.
          </p>
        )}
        </div>
      </section>
    </div>
  );
}
