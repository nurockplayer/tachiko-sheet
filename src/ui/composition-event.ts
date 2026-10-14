import type { KeyboardEvent as ReactKeyboardEvent } from "react";

export function isComposingEvent(event: ReactKeyboardEvent<HTMLElement>): boolean {
  const native = event.nativeEvent as KeyboardEvent;
  return native.isComposing === true || native.keyCode === 229;
}
