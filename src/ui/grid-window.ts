// Row windowing for large tables. Rendering every row of an 8,406-row import
// makes each publication reconcile ~25k cells. Tables at or below the
// threshold render completely, exactly as before.
export const GRID_WINDOW_THRESHOLD = 200;
export const GRID_WINDOW_OVERSCAN = 30;

export interface GridWindowRange {
  start: number;
  end: number;
}

export type GridWindowSegment =
  | { kind: "row"; index: number }
  | { kind: "spacer"; key: string; rows: number };

/**
 * A scroll extent independent of the rows/spacers React is replacing. It must
 * cover the footer (totals and entry rows) too: otherwise the table's own
 * height, which shifts with fractional row heights as the window moves,
 * decides the extent and the bottom of the scroll range never settles.
 */
export function gridWindowScrollHeight(rowCount: number, rowHeight: number, headerHeight: number, footerHeight = 0): number {
  return rowCount * rowHeight + headerHeight + footerHeight;
}

export function gridWindowRange(
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  rowCount: number,
  overscan = GRID_WINDOW_OVERSCAN,
): GridWindowRange {
  const pitch = rowHeight > 0 ? rowHeight : 1;
  const first = Math.floor(Math.max(0, scrollTop) / pitch);
  const visible = Math.ceil(Math.max(0, viewportHeight) / pitch) + 1;
  const start = Math.max(0, Math.min(rowCount, first - overscan));
  const end = Math.max(start, Math.min(rowCount, first + visible + overscan));
  return { start, end };
}

/** Window centred on one row, used before focusing a row outside the window. */
export function gridWindowAround(index: number, current: GridWindowRange, rowCount: number): GridWindowRange {
  if (index >= current.start && index < current.end) return current;
  const size = Math.max(1, current.end - current.start);
  const start = Math.max(0, Math.min(Math.max(0, rowCount - size), index - Math.floor(size / 2)));
  return { start, end: Math.min(rowCount, start + size) };
}

/**
 * Displayed rows kept mounted outside the window: the editor, selection, focus
 * and pending focus. The first row is also pinned whenever the focused entity
 * is not displayed (or nothing is focused), because the grid's tabIndex=0
 * fallback is that row's first cell: a filter can hide the focused row, and an
 * unmounted fallback would make Tab skip the whole grid.
 */
export function gridPinnedRows(
  entities: readonly (string | null | undefined)[],
  indexByEntity: ReadonlyMap<string, number>,
  focusedEntity: string | null | undefined,
): number[] {
  const pinned: number[] = [];
  for (const entity of entities) {
    const index = entity ? indexByEntity.get(entity) : undefined;
    if (index !== undefined) pinned.push(index);
  }
  if (!focusedEntity || !indexByEntity.has(focusedEntity)) pinned.push(0);
  return pinned;
}

/**
 * Rendered rows in order: the window plus pinned rows (focused/editing/selected)
 * so a live editor or focused cell is never unmounted by scrolling. Gaps are
 * spacer rows whose height preserves the scroll geometry.
 */
export function gridWindowSegments(
  range: GridWindowRange,
  pinned: readonly number[],
  rowCount: number,
): GridWindowSegment[] {
  const indices = new Set<number>();
  // The range may be stale for one render after the table shrinks or switches.
  for (let index = Math.max(0, range.start); index < Math.min(range.end, rowCount); index++) indices.add(index);
  for (const index of pinned) if (Number.isInteger(index) && index >= 0 && index < rowCount) indices.add(index);
  const ordered = [...indices].sort((a, b) => a - b);
  const segments: GridWindowSegment[] = [];
  let next = 0;
  for (const index of ordered) {
    if (index > next) segments.push({ kind: "spacer", key: `spacer-${next}`, rows: index - next });
    segments.push({ kind: "row", index });
    next = index + 1;
  }
  if (rowCount > next) segments.push({ kind: "spacer", key: `spacer-${next}`, rows: rowCount - next });
  return segments;
}

/** Scroll offset that brings a row fully into view, or null when it already is. */
export function scrollTopToReveal(
  index: number,
  rowHeight: number,
  headerHeight: number,
  scrollTop: number,
  viewportHeight: number,
): number | null {
  const top = index * rowHeight;
  const bottom = top + rowHeight;
  const visibleTop = scrollTop;
  const visibleBottom = scrollTop + Math.max(rowHeight, viewportHeight - headerHeight);
  if (top < visibleTop) return top;
  if (bottom > visibleBottom) return bottom - Math.max(rowHeight, viewportHeight - headerHeight);
  return null;
}

/**
 * Row pitch for spacer heights: the median rendered row height, so a few
 * rows that differ (a focused or edited row kept rendered) cannot skew the
 * geometry of thousands of rows. Returns null when nothing is measurable.
 */
export function measuredRowPitch(heights: readonly number[]): number | null {
  const valid = heights.filter((height) => Number.isFinite(height) && height > 0).sort((a, b) => a - b);
  return valid.length === 0 ? null : valid[Math.floor(valid.length / 2)]!;
}
