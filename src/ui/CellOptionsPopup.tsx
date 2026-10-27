import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
  const [box, setBox] = useState<{ left: number; top: number; minWidth: number } | null>(null);

  useLayoutEffect(() => {
    if (!anchor) return;
    const place = (): void => {
      const rect = anchor.getBoundingClientRect();
      setBox(current => current && current.left === rect.left && current.top === rect.bottom && current.minWidth === rect.width
        ? current : { left: rect.left, top: rect.bottom, minWidth: rect.width });
    };
    place();
    // Grid scrolling moves the cell; capture catches every scrolling ancestor.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => { window.removeEventListener("scroll", place, true); window.removeEventListener("resize", place); };
  }, [anchor]);

  useLayoutEffect(() => {
    if (activeIndex < 0) return;
    listRef.current?.children[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (!container || !box) return null;
  return createPortal(
    <ul ref={listRef} role="listbox" id={id} className="ts-cell-options" data-testid="cell-editor-options" aria-label={label}
      style={{ left: box.left, top: box.top, minWidth: box.minWidth }}>
      {options.map((option, index) => <li
        key={option}
        id={`${id}-${index}`}
        role="option"
        aria-selected={index === activeIndex}
        className={index === activeIndex ? "ts-cell-option ts-cell-option--active" : "ts-cell-option"}
        // Keep focus in the editor so a draft-row editor does not blur away.
        onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); onPick(option); }}
        onClick={(event) => event.stopPropagation()}
      >{option}</li>)}
    </ul>,
    container,
  );
}
