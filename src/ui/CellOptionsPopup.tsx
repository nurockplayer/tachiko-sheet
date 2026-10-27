import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** .ts-cell-options max-height in rem; converted with the live root font size. */
const LIST_MAX_HEIGHT_REM = 12;

interface CellOptionsPopupProps {
  id: string;
  label: string;
  options: readonly string[];
  activeIndex: number;
  /** The editing cell; grid cells clip overflow, so the list floats in the shell instead. */
  anchor: HTMLElement | null;
  container: HTMLElement | null;
  onPick(value: string): void;
}

/** The allowed-values list under a cell editor. Focus stays in the editor; the editor owns the keys. */
export function CellOptionsPopup({ id, label, options, activeIndex, anchor, container, onPick }: CellOptionsPopupProps) {
  const listRef = useRef<HTMLUListElement | null>(null);
  const [box, setBox] = useState<{ left: number; top: number; minWidth: number; maxHeight?: number } | null>(null);

  useLayoutEffect(() => {
    if (!anchor) return;
    const place = (): void => {
      const rect = anchor.getBoundingClientRect();
      const list = listRef.current;
      // Natural size, before any height cap this placement applies.
      const rootFont = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const height = list ? Math.min(list.scrollHeight + list.offsetHeight - list.clientHeight, LIST_MAX_HEIGHT_REM * rootFont) : 0;
      const width = Math.max(list?.offsetWidth ?? 0, rect.width);
      const below = window.innerHeight - rect.bottom;
      const above = rect.top;
      // Below the cell when it fits; above it near the bottom (the new-row line); else the larger side, capped.
      const placeAbove = height > below && (height <= above || above > below);
      const maxHeight = height > (placeAbove ? above : below) ? Math.max(0, placeAbove ? above : below) : undefined;
      const top = placeAbove ? rect.top - (maxHeight ?? height) : rect.bottom;
      const left = Math.max(0, Math.min(rect.left, window.innerWidth - width));
      setBox(current => current && current.left === left && current.top === top && current.minWidth === rect.width && current.maxHeight === maxHeight
        ? current : { left, top, minWidth: rect.width, maxHeight });
    };
    place();
    // Grid scrolling moves the cell; capture catches every scrolling ancestor.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => { window.removeEventListener("scroll", place, true); window.removeEventListener("resize", place); };
  }, [anchor, box === null, options.join("\u0000")]);

  useLayoutEffect(() => {
    if (activeIndex < 0) return;
    listRef.current?.children[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (!container || !box) return null;
  return createPortal(
    <ul ref={listRef} role="listbox" id={id} className="ts-cell-options" data-testid="cell-editor-options" aria-label={label}
      style={{ left: box.left, top: box.top, minWidth: box.minWidth, maxHeight: box.maxHeight }}>
      {options.map((option, index) => <li
        key={option}
        id={`${id}-${index}`}
        role="option"
        aria-selected={index === activeIndex}
        className={index === activeIndex ? "ts-cell-option ts-cell-option--active" : "ts-cell-option"}
        // Keep focus in the editor so a draft-row editor does not blur away.
        onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); onPick(option); }}
        // A pointer click already picked on mousedown; a synthetic click (assistive technology) has detail 0.
        onClick={(event) => { event.stopPropagation(); if (event.detail === 0) onPick(option); }}
      >{option}</li>)}
    </ul>,
    container,
  );
}
