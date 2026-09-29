export type HistoryDirection = "undo" | "redo";

export interface HistoryKeyboardInput {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  repeat: boolean;
  isComposing?: boolean;
  keyCode?: number;
}

export function historyCommandForKey(
  event: HistoryKeyboardInput,
  target: EventTarget | null,
  blockedByEditorOrModal: boolean,
): HistoryDirection | null {
  if (blockedByEditorOrModal || event.altKey || event.repeat || event.isComposing || event.keyCode === 229) return null;
  if (!(event.metaKey || event.ctrlKey)) return null;
  if (event.metaKey && event.ctrlKey) return null;
  if (typeof Element !== "undefined" && target instanceof Element) {
    if (target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='dialog'], dialog[open]")) return null;
  }
  const key = event.key.toLowerCase();
  if (key === "z" && (event.metaKey || event.ctrlKey)) return event.shiftKey ? "redo" : "undo";
  if (key === "y" && event.ctrlKey && !event.shiftKey) return "redo";
  return null;
}
