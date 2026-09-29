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
  defaultPrevented?: boolean;
}

export function historyCommandForKey(
  event: HistoryKeyboardInput,
  target: EventTarget | null,
  blockedByEditorOrModal: boolean,
  focusedTarget: EventTarget | null = target,
): HistoryDirection | null {
  if (blockedByEditorOrModal || event.defaultPrevented || event.altKey || event.repeat || event.isComposing || event.keyCode === 229) return null;
  if (!(event.metaKey || event.ctrlKey)) return null;
  if (event.metaKey && event.ctrlKey) return null;
  const nativeOwner = (candidate: EventTarget | null): boolean => {
    if (typeof Element === "undefined" || !(candidate instanceof Element)) return false;
    return Boolean(candidate.closest("input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='dialog'], dialog[open]"));
  };
  if (nativeOwner(target) || nativeOwner(focusedTarget)) {
    return null;
  }
  const key = event.key.toLowerCase();
  if (key === "z" && (event.metaKey || event.ctrlKey)) return event.shiftKey ? "redo" : "undo";
  if (key === "y" && event.ctrlKey && !event.shiftKey) return "redo";
  return null;
}
