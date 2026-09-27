import { describe, expect, it } from "vitest";

import { placeAppearancePopover } from "./appearance-placement.js";

const offsetParent = { left: 0, top: 0, clientLeft: 0, clientTop: 0, scrollLeft: 0, scrollTop: 0 };

const place = (overrides: Partial<Parameters<typeof placeAppearancePopover>[0]> = {}) =>
  placeAppearancePopover({
    context: "workbook",
    viewportWidth: 1512,
    viewport: { left: 0, top: 0, right: 1512, bottom: 982 },
    anchor: { left: 1200, top: 100, right: 1312, bottom: 140 },
    panelWidth: 348,
    naturalHeight: 420,
    panelChromeHeight: 64,
    interactiveControlHeight: 40,
    focusClearanceHeight: 10,
    offsetParent,
    ...overrides,
  });

describe("measured Appearance popover placement", () => {
  it("retains the desktop trigger-right and below position when the natural panel fits", () => {
    const result = place();
    expect(result).toMatchObject({ left: 964, top: 148, maxHeight: 420, side: "below" });
  });

  it("uses the full compact Home header edge and approved 16px inset", () => {
    const result = place({
      context: "home",
      viewportWidth: 390,
      viewport: { left: 0, top: 0, right: 390, bottom: 640 },
      anchor: { left: 32, top: 28, right: 144, bottom: 60 },
      homeHeaderLeft: 16,
      homeHeaderBottom: 112,
      panelWidth: 326,
      naturalHeight: 400,
      offsetParent: { ...offsetParent, left: 16, top: 28 },
    });
    expect(result).toMatchObject({ left: 16, top: 92, viewportLeft: 32, viewportTop: 120, maxHeight: 400, side: "below" });
  });

  it("anchors compact Home placement to the header left edge even when the trigger is right-aligned", () => {
    const result = place({
      context: "home",
      viewportWidth: 390,
      viewport: { left: 0, top: 0, right: 390, bottom: 640 },
      anchor: { left: 246, top: 28, right: 358, bottom: 60 },
      homeHeaderLeft: 16,
      homeHeaderBottom: 112,
      panelWidth: 326,
      naturalHeight: 300,
      offsetParent: { ...offsetParent, left: 16, top: 28 },
    });
    expect(result).toMatchObject({ left: 16, viewportLeft: 32, viewportTop: 120, side: "below" });
  });

  it("chooses the above side when it fits and below does not", () => {
    const result = place({
      viewport: { left: 0, top: 0, right: 800, bottom: 400 },
      anchor: { left: 350, top: 300, right: 462, bottom: 340 },
      panelWidth: 300,
      naturalHeight: 200,
    });
    expect(result).toMatchObject({ left: 162, top: 92, maxHeight: 200, side: "above" });
  });

  it("constrains to the larger available side when neither side fits naturally", () => {
    const result = place({
      viewport: { left: 0, top: 0, right: 800, bottom: 320 },
      anchor: { left: 350, top: 190, right: 462, bottom: 230 },
      panelWidth: 300,
      naturalHeight: 420,
    });
    expect(result.maxHeight).toBe(170);
    expect(result.side).toBe("above");
    expect(result.viewportTop).toBe(12);
  });

  it("clamps an offscreen anchor's panel into the usable viewport", () => {
    const result = place({
      viewport: { left: 40, top: 20, right: 440, bottom: 320 },
      anchor: { left: 700, top: 500, right: 812, bottom: 540 },
      panelWidth: 348,
      naturalHeight: 500,
    });
    expect(result.side).toBe("clamped");
    expect(result.viewportLeft).toBe(80);
    expect(result.viewportTop).toBe(32);
    expect(result.maxHeight).toBe(276);
  });

  it("shrinks to a narrow visual viewport before horizontal placement", () => {
    const result = place({
      context: "home",
      viewportWidth: 390,
      viewport: { left: 50, top: 30, right: 250, bottom: 500 },
      anchor: { left: 82, top: 50, right: 194, bottom: 82 },
      homeHeaderBottom: 110,
      panelWidth: 348,
      naturalHeight: 400,
    });
    expect(result.maxWidth).toBe(176);
    expect(result.viewportLeft).toBe(62);
    expect(result.viewportLeft + result.maxWidth).toBe(238);
  });

  it("uses the full inset viewport when neither side fits measured chrome and one actual control", () => {
    const result = place({
      viewport: { left: 0, top: 0, right: 800, bottom: 200 },
      anchor: { left: 350, top: 90, right: 462, bottom: 110 },
      panelWidth: 300,
      naturalHeight: 420,
      panelChromeHeight: 64,
      interactiveControlHeight: 40,
      focusClearanceHeight: 10,
    });
    expect(result.side).toBe("clamped");
    expect(result.viewportTop).toBe(12);
    expect(result.maxHeight).toBe(176);
  });

  it("uses the full viewport when both short sides are positive but below measured usable height", () => {
    const result = place({
      context: "home",
      viewportWidth: 320,
      viewport: { left: 0, top: 0, right: 320, bottom: 200 },
      anchor: { left: 16, top: 80, right: 304, bottom: 116 },
      homeHeaderLeft: 16,
      homeHeaderBottom: 116,
      panelWidth: 288,
      naturalHeight: 420,
      panelChromeHeight: 80,
      interactiveControlHeight: 36,
      focusClearanceHeight: 10,
    });
    expect(result).toMatchObject({ side: "clamped", viewportTop: 12, maxHeight: 176 });
  });

  it("preserves the existing workbook breakpoint anchors", () => {
    const tablet = place({ viewportWidth: 768, anchor: { left: 20, top: 100, right: 132, bottom: 140 } });
    const phone = place({ viewportWidth: 390, anchor: { left: 220, top: 100, right: 332, bottom: 140 } });
    expect(tablet.viewportLeft).toBe(32);
    expect(phone.viewportLeft).toBe(12);
  });
});
