/** Table names remain distinct from every mode, including imported names. */
export function tableTabName(name: string, index: number, count: number): string {
  return `${name} (table ${index + 1} of ${count})`;
}

export function tableTabIndex(key: string, index: number, count: number): number | null {
  if (count < 2) return null;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowLeft" || key === "PageUp") return (index - 1 + count) % count;
  if (key === "ArrowRight" || key === "PageDown") return (index + 1) % count;
  return null;
}

export function isTableSwitchShortcut(event: {
  key: string; ctrlKey: boolean; altKey: boolean; metaKey: boolean; shiftKey: boolean;
}): boolean {
  return event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey &&
    (event.key === "PageUp" || event.key === "PageDown");
}
