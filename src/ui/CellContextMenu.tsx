import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { nextMenuIndex, type CellMenuItem } from "./cell-context-menu.js";

/** Distance the menu keeps from the viewport edge it would overflow. */
const VIEWPORT_MARGIN = 8;
const NAVIGATION_KEYS = ["ArrowDown", "ArrowUp", "Home", "End"];

interface CellContextMenuProps {
  x: number;
  y: number;
  items: readonly CellMenuItem[];
  label?: string;
  onClose(): void;
}

/** The grid's right-click menu: one open menu at a time, dismissed by any move away from it. */
export function CellContextMenu({ x, y, items, label = "Cell actions", onClose }: CellContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  // The parent rebuilds `items` on its own renders; the menu only reads them
  // when it acts, never to decide where focus goes after mount.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const [box, setBox] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const first = nextMenuIndex(itemsRef.current, -1, "ArrowDown");
    if (first >= 0) itemRefs.current[first]?.focus();
  }, []);

  // The menu opens at the pointer; measure it and pull it back inside the viewport.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const width = menu.offsetWidth, height = menu.offsetHeight;
    const left = Math.max(VIEWPORT_MARGIN, Math.min(x, window.innerWidth - width - VIEWPORT_MARGIN));
    const top = Math.max(VIEWPORT_MARGIN, Math.min(y, window.innerHeight - height - VIEWPORT_MARGIN));
    setBox((current) => current.left === left && current.top === top ? current : { left, top });
  }, [x, y]);

  useEffect(() => {
    const outside = (event: PointerEvent): void => {
      if (menuRef.current?.contains(event.target as Node)) return;
      onClose();
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [onClose]);

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    // Nothing typed in the menu belongs to the grid underneath it.
    event.stopPropagation();
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      onClose();
      return;
    }
    // The focused item decides, since a press can move focus to any of them.
    const active = itemRefs.current.findIndex((node) => node !== null && node === document.activeElement);
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const item = items[active];
      if (item !== undefined && item !== "separator" && !item.disabled) item.run();
      return;
    }
    if (!NAVIGATION_KEYS.includes(event.key)) return;
    event.preventDefault();
    const next = nextMenuIndex(items, active, event.key);
    if (next >= 0) itemRefs.current[next]?.focus();
  }

  return (
    <div ref={menuRef} role="menu" aria-label={label} className="ts-cell-menu" style={{ left: box.left, top: box.top }} onKeyDown={onKeyDown}>
      {items.map((item, index) => item === "separator"
        ? <div key={`separator-${index}`} role="separator" className="ts-cell-menu-separator" />
        : <button
          key={`${item.label}\u0000${index}`}
          ref={(node) => { itemRefs.current[index] = node; }}
          type="button"
          role="menuitem"
          className="ts-cell-menu-item"
          aria-disabled={item.disabled || undefined}
          tabIndex={-1}
          onClick={() => { if (!item.disabled) item.run(); }}
        >
          <span className="ts-cell-menu-label">{item.label}</span>
          {item.shortcut ? <span className="ts-cell-menu-shortcut" aria-hidden="true">{item.shortcut}</span> : null}
        </button>)}
    </div>
  );
}
