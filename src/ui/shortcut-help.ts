export type ShortcutEntry = { keys: string[]; action: string; desktopOnly?: boolean };
export type ShortcutGroup = { name: string; entries: ShortcutEntry[] };

const groups: ShortcutGroup[] = [
  { name: "Move", entries: [
    { keys: ["Arrow keys"], action: "Move between cells" },
    { keys: ["Mod+Arrow"], action: "Move to edge of data" },
    { keys: ["Home", "End"], action: "Move to start or end of row" },
    { keys: ["Mod+Home", "Mod+End"], action: "Move to start or end of table" },
    { keys: ["PageUp", "PageDown"], action: "Move one page" },
    { keys: ["Tab", "Shift+Tab"], action: "Move right or left" },
    { keys: ["Ctrl+PageUp", "Ctrl+PageDown"], action: "Previous or next sheet" },
  ] },
  { name: "Select", entries: [
    { keys: ["Shift+Arrow"], action: "Extend selection" },
    { keys: ["Mod+Shift+Arrow"], action: "Extend selection to edge of data" },
    { keys: ["Shift+Home", "Shift+End"], action: "Select to start or end of row" },
    { keys: ["Mod+A"], action: "Select table" },
    { keys: ["Shift+Space"], action: "Select row" },
    { keys: ["Mod+Space"], action: "Select column" },
    { keys: ["Escape"], action: "Clear selection" },
    { keys: ["Click column letter", "Click row number"], action: "Select column or row; Shift+click to extend" },
  ] },
  { name: "Edit", entries: [
    { keys: ["Enter", "F2"], action: "Edit cell" },
    { keys: ["Type"], action: "Replace cell contents" },
    { keys: ["Enter (editing)", "Shift+Enter"], action: "Commit and move down or up" },
    { keys: ["Tab"], action: "Commit and move right" },
    { keys: ["Mod+Enter"], action: "Fill selection with entry" },
    { keys: ["Alt+Enter"], action: "New line in a Text cell" },
    { keys: ["Escape"], action: "Cancel edit" },
    { keys: ["Delete", "Backspace"], action: "Clear cells" },
    { keys: ["Mod+D"], action: "Fill down" },
    { keys: ["Mod+'"], action: "Copy from cell above" },
    { keys: ["Mod+Shift+'"], action: "Copy value from cell above" },
    { keys: ["Mod+;"], action: "Enter today's date in a Date cell" },
    { keys: ["Shift+F2"], action: "Go to formula bar" },
  ] },
  { name: "Copy and paste", entries: [
    { keys: ["Mod+C"], action: "Copy" }, { keys: ["Mod+X"], action: "Cut" },
    { keys: ["Mod+V"], action: "Paste" }, { keys: ["Mod+Shift+V"], action: "Paste values" },
    { keys: ["Ctrl+Alt+V"], action: "Paste Special" },
    { keys: ["Shift+F10", "Menu key"], action: "Open cell menu" },
  ] },
  { name: "Find and view", entries: [
    { keys: ["Mod+F"], action: "Find" }, { keys: ["Ctrl+`"], action: "Show formulas" },
    { keys: ["Mod+P"], action: "Print table" },
    { keys: ["Mod+Shift+L"], action: "Filter: open or clear" },
  ] },
  { name: "File and history", entries: [
    { keys: ["Mod+S"], action: "Save" }, { keys: ["Mod+Z"], action: "Undo" },
    { keys: ["Ctrl+Y", "Ctrl+Shift+Z"], action: "Redo" },
    { keys: ["Mod+N"], action: "New table", desktopOnly: true },
    { keys: ["Mod+O"], action: "Open", desktopOnly: true },
    { keys: ["Mod+Shift+S"], action: "Save a copy", desktopOnly: true },
    { keys: ["Mod+Q"], action: "Quit", desktopOnly: true },
  ] },
  { name: "Help", entries: [{ keys: ["Mod+/"], action: "Keyboard shortcuts" }] },
];

export function shortcutHelpGroups({ mac, desktop }: { mac: boolean; desktop: boolean }): ShortcutGroup[] {
  return groups.map(group => ({ ...group, entries: group.entries.filter(entry => desktop || !entry.desktopOnly).map(entry => ({
    ...entry,
    keys: (mac && entry.action === "Redo" ? ["Mod+Shift+Z"] : mac && entry.action === "Paste Special" ? ["Ctrl+⌘V"] : entry.keys)
      .map(key => key.replace(/Mod\+/g, mac ? "⌘" : "Ctrl+")),
  })) }));
}
