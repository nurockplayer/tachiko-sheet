import { describe, expect, it } from "vitest";
import { historyCommandForKey } from "./history-keyboard.js";

const base = { key: "z", metaKey: true, ctrlKey: false, shiftKey: false, altKey: false, repeat: false };

describe("Sheet history keyboard capture", () => {
  it("maps only supported platform shortcuts and rejects unrelated modifiers", () => {
    expect(historyCommandForKey(base, null, false)).toBe("undo");
    expect(historyCommandForKey({ ...base, shiftKey: true }, null, false)).toBe("redo");
    expect(historyCommandForKey({ ...base, metaKey: false, ctrlKey: true }, null, false)).toBe("undo");
    expect(historyCommandForKey({ ...base, key: "y", metaKey: false, ctrlKey: true }, null, false)).toBe("redo");
    expect(historyCommandForKey({ ...base, altKey: true }, null, false)).toBeNull();
    expect(historyCommandForKey({ ...base, metaKey: false, ctrlKey: false }, null, false)).toBeNull();
    expect(historyCommandForKey({ ...base, key: "z", metaKey: true, ctrlKey: true }, null, false)).toBeNull();
    expect(historyCommandForKey({ ...base, defaultPrevented: true }, null, false)).toBeNull();
  });

  it("leaves repeated, composing, editor, and modal interactions to their owner", () => {
    expect(historyCommandForKey({ ...base, repeat: true }, null, false)).toBeNull();
    expect(historyCommandForKey({ ...base, isComposing: true }, null, false)).toBeNull();
    expect(historyCommandForKey({ ...base, keyCode: 229 }, null, false)).toBeNull();
    expect(historyCommandForKey(base, null, true)).toBeNull();
  });
});
