/** One row of the cell context menu; `"separator"` draws a rule instead of a command. */
export type CellMenuItem = { label: string; shortcut?: string; disabled?: boolean; run(): void } | "separator";

function isCommand(item: CellMenuItem | undefined): item is Exclude<CellMenuItem, "separator"> {
  return item !== undefined && item !== "separator";
}

/**
 * The index a menu key moves focus to, skipping separators and disabled rows
 * and wrapping at both ends. An unknown key keeps the current index; a menu
 * with no enabled row answers -1.
 */
export function nextMenuIndex(items: readonly CellMenuItem[], current: number, key: string): number {
  const enabled: number[] = [];
  items.forEach((item, index) => { if (isCommand(item) && !item.disabled) enabled.push(index); });
  if (enabled.length === 0) return -1;
  if (key === "Home") return enabled[0]!;
  if (key === "End") return enabled[enabled.length - 1]!;
  if (key === "ArrowDown") return enabled.find((index) => index > current) ?? enabled[0]!;
  if (key === "ArrowUp") return [...enabled].reverse().find((index) => index < current) ?? enabled[enabled.length - 1]!;
  return current;
}

/** The shortcut label for a key, in the platform's own notation. */
export function menuShortcut(key: string, mac: boolean): string {
  return mac ? `⌘${key}` : `Ctrl+${key}`;
}

/** A Mac reports "MacIntel"; every other platform uses Ctrl labels. */
export function isMacPlatform(): boolean {
  const platform = typeof navigator === "undefined" ? "" : navigator.platform ?? "";
  return /mac/i.test(platform);
}
