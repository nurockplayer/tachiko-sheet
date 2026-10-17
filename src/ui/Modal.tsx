import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { isComposingEvent } from "./composition-event.js";

export function Modal({ label, onCancel, children, variant = "review", dismissDisabled = false }: { label: string; onCancel: () => void; children: ReactNode; variant?: "save" | "close" | "import" | "review"; dismissDisabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const target =
      root.querySelector<HTMLElement>("[data-autofocus]") ?? focusableElements(root)[0] ?? null;
    target?.focus();
  }, []);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const document = root.ownerDocument;
    function onEscape(event: KeyboardEvent): void {
      if (event.key !== "Escape" || event.isComposing || event.keyCode === 229) return;
      const modals = document.querySelectorAll(".ts-modal[aria-modal='true']");
      if (modals.item(modals.length - 1) !== root) return;
      // Capture Escape even when a disabled control has dropped focus to body.
      event.preventDefault();
      event.stopPropagation();
      if (!dismissDisabled) onCancel();
    }
    document.addEventListener("keydown", onEscape, true);
    return () => document.removeEventListener("keydown", onEscape, true);
  }, [onCancel, dismissDisabled]);

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (isComposingEvent(event)) return;
    if (event.key !== "Tab") return;
    const root = ref.current;
    if (!root) return;
    const nodes = focusableElements(root);
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (!first || !last) return;
    const active = root.ownerDocument.activeElement;
    if (event.shiftKey && (active === root || active === first || !root.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === root || active === last)) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className="ts-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (dismissDisabled) event.preventDefault();
        else onCancel();
      }}
    >
      <div
        ref={ref}
        className={`ts-modal ts-modal--${variant}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </div>
  );
}

function focusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), details > summary, [tabindex]:not([tabindex='-1'])",
    ),
  );
}
