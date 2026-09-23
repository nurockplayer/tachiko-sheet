import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { AppearancePreferenceSnapshot } from "../application/appearance-preference.js";
import { AppearanceSelector } from "./AppearanceSelector.js";

const preference = (overrides: Partial<AppearancePreferenceSnapshot> = {}): AppearancePreferenceSnapshot => ({
  selection: { profileId: "tachiko", density: "compact" },
  pendingSelection: null,
  notice: null,
  notSaved: false,
  composing: false,
  ...overrides,
});

const renderSelector = (snapshot: AppearancePreferenceSnapshot) =>
  renderToStaticMarkup(<AppearanceSelector preference={snapshot} onSelectProfile={vi.fn()} onSelectDensity={vi.fn()} />);

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
    expect((html.match(/type=\"radio\"/g) ?? [])).toHaveLength(5);

    const groupNames = [...html.matchAll(/type=\"radio\"[^>]*name=\"([^\"]+)\"/g)].map((match) => match[1]);
    expect(groupNames).toHaveLength(5);
    expect(new Set(groupNames.slice(0, 3)).size).toBe(1);
    expect(new Set(groupNames.slice(3)).size).toBe(1);
    expect(groupNames[0]).not.toBe(groupNames[3]);
    expect(html).toContain("Changes appearance only. No workbook save.");
  });

  it("reflects the latest queued selection in checked radios while keeping source state controlled", () => {
    const html = renderSelector(preference({
      selection: { profileId: "tachiko", density: "compact" },
      pendingSelection: { profileId: "familiar-spreadsheet", density: "comfortable" },
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
      selection: { profileId: "familiar-spreadsheet", density: "compact" },
      notSaved: true,
    }));

    expect(html).not.toContain("Saved appearance could not be loaded. Using Tachiko for this session.");
    expect(html).toContain("Appearance changed for this session, but could not be saved.");
    expect((html.match(/role=\"status\"/g) ?? [])).toHaveLength(1);
    expect((html.match(/aria-live=\"polite\"/g) ?? [])).toHaveLength(1);
    expect(html).not.toMatch(/<button[^>]*>Save<\/button>/);
  });
});
