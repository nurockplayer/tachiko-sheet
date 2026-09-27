export type AppearancePopoverContext = "home" | "workbook";

export type AppearancePlacementInput = Readonly<{
  context: AppearancePopoverContext;
  viewportWidth: number;
  viewport: Readonly<{ left: number; top: number; right: number; bottom: number }>;
  anchor: Readonly<{ left: number; top: number; right: number; bottom: number }>;
  homeHeaderLeft?: number;
  homeHeaderBottom?: number;
  panelWidth: number;
  naturalHeight: number;
  panelChromeHeight: number;
  interactiveControlHeight: number;
  focusClearanceHeight: number;
  offsetParent: Readonly<{ left: number; top: number; clientLeft: number; clientTop: number; scrollLeft: number; scrollTop: number }>;
  inset?: number;
  gap?: number;
}>;

export type AppearancePlacement = Readonly<{
  left: number;
  top: number;
  maxHeight: number;
  maxWidth: number;
  viewportLeft: number;
  viewportTop: number;
  side: "below" | "above" | "clamped";
}>;

/** Resolve the existing context-specific preferred position against the usable visual viewport. */
export function placeAppearancePopover(input: AppearancePlacementInput): AppearancePlacement {
  const inset = input.inset ?? 12;
  const gap = input.gap ?? 8;
  const { viewport, anchor } = input;
  const maxWidth = Math.max(0, viewport.right - viewport.left - inset * 2);
  const panelWidth = Math.min(input.panelWidth, maxWidth);
  const preferredBelow = input.context === "home" && input.viewportWidth < 600
    ? (input.homeHeaderBottom ?? anchor.bottom) + gap
    : anchor.bottom + gap;

  let preferredLeft: number;
  if (input.context === "home") {
    preferredLeft = input.viewportWidth < 600
      ? (input.homeHeaderLeft ?? anchor.left) + 16
      : anchor.right - panelWidth;
  } else if (input.viewportWidth >= 1024) {
    preferredLeft = anchor.right - panelWidth;
  } else if (input.viewportWidth >= 600) {
    preferredLeft = anchor.left + 12;
  } else {
    preferredLeft = anchor.right + 12 - panelWidth;
  }

  const minLeft = viewport.left + inset;
  const maxLeft = Math.max(minLeft, viewport.right - inset - panelWidth);
  const left = Math.min(maxLeft, Math.max(minLeft, preferredLeft));
  const usableTop = viewport.top + inset;
  const usableBottom = viewport.bottom - inset;
  const belowHeight = Math.max(0, usableBottom - preferredBelow);
  const aboveBottom = anchor.top - gap;
  const aboveHeight = Math.max(0, aboveBottom - usableTop);
  const anchorOffscreen = anchor.bottom < usableTop || anchor.top > usableBottom;
  const minimumUsableSideHeight = input.panelChromeHeight + input.interactiveControlHeight + input.focusClearanceHeight;

  let side: AppearancePlacement["side"] = "below";
  let viewportTop = preferredBelow;
  let availableHeight = belowHeight;
  if (anchorOffscreen) {
    side = "clamped";
    availableHeight = Math.max(0, usableBottom - usableTop);
    viewportTop = usableTop;
  } else if (input.naturalHeight <= belowHeight) {
    // Retain the natural preferred position whenever it fits.
  } else if (Math.max(belowHeight, aboveHeight) < minimumUsableSideHeight) {
    side = "clamped";
    availableHeight = Math.max(0, usableBottom - usableTop);
    viewportTop = usableTop;
  } else if (aboveHeight > belowHeight) {
    side = "above";
    availableHeight = aboveHeight;
    viewportTop = aboveBottom - Math.min(input.naturalHeight, aboveHeight);
  } else {
    viewportTop = Math.min(preferredBelow, usableBottom);
  }

  const maxHeight = Math.max(0, Math.min(input.naturalHeight, availableHeight));
  viewportTop = Math.max(usableTop, Math.min(viewportTop, usableBottom - maxHeight));
  const localLeft = left - input.offsetParent.left - input.offsetParent.clientLeft + input.offsetParent.scrollLeft;
  const localTop = viewportTop - input.offsetParent.top - input.offsetParent.clientTop + input.offsetParent.scrollTop;

  return { left: localLeft, top: localTop, maxHeight, maxWidth, viewportLeft: left, viewportTop, side };
}
