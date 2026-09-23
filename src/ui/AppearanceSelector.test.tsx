import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { AppearancePreferenceSnapshot } from "../application/appearance-preference.js";
import { TACHIKO_COMPACT_PORCELAIN_PROFILE } from "./interface-profile/profile.js";
import { AppearanceSelector } from "./AppearanceSelector.js";

const preference = (overrides: Partial<AppearancePreferenceSnapshot> = {}): AppearancePreferenceSnapshot => ({
  selection: { kind: "built-in", profileId: "tachiko", density: "compact" },
  pendingSelection: null,
  notice: null,
  notSaved: false,
  composing: false,
  ...overrides,
});

const renderSelector = (snapshot: AppearancePreferenceSnapshot) =>
  renderToStaticMarkup(
    <AppearanceSelector
      preference={snapshot}
      onSelectProfile={vi.fn(() => snapshot)}
      onSelectDensity={vi.fn(() => snapshot)}
      onSelectImported={vi.fn(() => snapshot)}
    />,
  );

describe("AppearanceSelector semantic rendering", () => {
  it("exposes a labelled application control and nonmodal dialog with separate native radio groups", () => {
    const html = renderSelector(preference());

    expect(html).toContain("aria-haspopup=\"dialog\"");
    expect(html).toContain("aria-expanded=\"false\"");
    expect(html).toContain("aria-controls=\"appearance-dialog-");
    expect(html).toContain("Appearance</button>");
    expect(html).toContain("role=\"dialog\"");
    expect(html).toContain("aria-modal=\"false\"");
    expect(html).toContain("aria-labelledby=\"appearance-dialog-");
    expect(html).toContain("<legend>Interface profile</legend>");
    expect(html).toContain("<legend>Density</legend>");
    expect(html).toContain("Custom profile");
    expect(html).toContain("Import profile…");
    expect(html).toContain("Export selected profile…");
    expect(html).toContain('type="file"');
    expect((html.match(/type=\"radio\"/g) ?? [])).toHaveLength(5);

    const groupNames = [...html.matchAll(/type=\"radio\"[^>]*name=\"([^\"]+)\"/g)].map((match) => match[1]);
    expect(groupNames).toHaveLength(5);
    expect(new Set(groupNames.slice(0, 3)).size).toBe(1);
    expect(new Set(groupNames.slice(3)).size).toBe(1);
    expect(groupNames[0]).not.toBe(groupNames[3]);
    expect(html).toContain("Changes appearance only. No workbook save.");
  });

  it("shows an active imported profile as its own radio with isolated plain-text name", () => {
    const html = renderSelector(preference({
      selection: { kind: "imported", profile: { ...TACHIKO_COMPACT_PORCELAIN_PROFILE, name: "Imported Tachiko" } },
    }));

    expect((html.match(/type="radio"/g) ?? [])).toHaveLength(6);
    expect(html).toMatch(/<input[^>]*checked=""[^>]*value="imported"/);
    expect(html).toContain('<bdi dir="auto">Imported Tachiko</bdi>');
    expect(html).toContain("Export requests normalized v1 JSON for the active profile.");
    expect(html).not.toContain('value="tachiko" checked=""');
  });

  it("keeps an imported IME choice pending and separate from the built-in identifiers", () => {
    const imported = { ...TACHIKO_COMPACT_PORCELAIN_PROFILE, name: "Tachiko" };
    const html = renderSelector(preference({
      selection: { kind: "built-in", profileId: "tachiko", density: "compact" },
      pendingSelection: { kind: "imported", profile: imported },
      composing: true,
    }));

    expect(html).toMatch(/<input[^>]*checked=""[^>]*value="imported"/);
    expect(html).toContain('<bdi dir="auto">Tachiko</bdi>');
    expect(html).not.toContain('value="tachiko" checked=""');
    expect(html).toMatch(/value="comfortable"/);
  });

  it("keeps an active imported choice available while a built-in IME choice is pending", () => {
    const active = { ...TACHIKO_COMPACT_PORCELAIN_PROFILE, name: "Active Import" };
    const html = renderSelector(preference({
      selection: { kind: "imported", profile: active },
      pendingSelection: { kind: "built-in", profileId: "minimal-focus", density: "compact" },
      composing: true,
    }));

    expect(html).toMatch(/<input[^>]*checked=""[^>]*value="minimal-focus"/);
    expect(html).toContain('value="imported"');
    expect(html).toContain('<bdi dir="auto">Active Import</bdi>');
  });

  it("reflects the latest queued selection in checked radios while keeping source state controlled", () => {
    const html = renderSelector(preference({
      selection: { kind: "built-in", profileId: "tachiko", density: "compact" },
      pendingSelection: { kind: "built-in", profileId: "familiar-spreadsheet", density: "comfortable" },
      composing: true,
    }));

    expect(html).toMatch(/<input[^>]*checked=""[^>]*value="familiar-spreadsheet"/);
    expect(html).toMatch(/<input[^>]*checked=""[^>]*value="comfortable"/);
    expect(html).not.toContain('value="tachiko" checked=""');
    expect(html).not.toContain('value="compact" checked=""');
  });

  it("renders the load-fallback disclosure accessibly", () => {
    const html = renderSelector(preference({ notice: "invalid-preference" }));
    expect(html).toContain("Saved appearance could not be loaded. Using Tachiko for this session.");
    expect(html).not.toContain("Appearance changed for this session, but could not be saved.");
    expect((html.match(/role=\"status\"/g) ?? [])).toHaveLength(1);
    expect((html.match(/aria-live=\"polite\"/g) ?? [])).toHaveLength(1);
  });

  it("renders only the active session write-failure disclosure after a changed choice", () => {
    const html = renderSelector(preference({
      selection: { kind: "built-in", profileId: "familiar-spreadsheet", density: "compact" },
      notSaved: true,
    }));

    expect(html).not.toContain("Saved appearance could not be loaded. Using Tachiko for this session.");
    expect(html).toContain("Appearance changed for this session, but could not be saved.");
    expect((html.match(/role=\"status\"/g) ?? [])).toHaveLength(1);
    expect((html.match(/aria-live=\"polite\"/g) ?? [])).toHaveLength(1);
    expect(html).not.toMatch(/<button[^>]*>Save<\/button>/);
  });
});
