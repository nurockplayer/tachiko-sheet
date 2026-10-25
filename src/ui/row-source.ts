/**
 * Read-only row access for one projected table.
 *
 * Work's capacity API will serve large tables through bounded windows
 * (`query_table_window`, at most 256 rows per call) instead of one whole-table
 * projection. Production code reads rows through this seam so that change stays
 * local here. Until that API is pinned, every source is backed by today's
 * in-memory `table.rows`.
 */
import { rowEntity, type WorkbookView } from "../contracts.js";
import type { TableRow } from "./projection-access.js";

export interface RowSource {
  /** Rows in the current displayed order. */
  readonly total: number;
  rowAt(index: number): TableRow | undefined;
  /** `count` rows from `start`; an empty array outside the table. */
  rows(start: number, count: number): readonly TableRow[];
  byEntity(entity: string): TableRow | undefined;
  /** Position in this source, or -1 when the entity is not in it. */
  indexOf(entity: string): number;
  /** Whether the row at `index` is loaded. Every row is, for now. */
  loaded(index: number): boolean;
  /**
   * Every row of the table. Only for callers that genuinely need the whole
   * table today (client sort/filter, aggregates, whole-selection commands);
   * each use must move to a Work view query or windows at capacity A-04.
   */
  allRowsForNow(): readonly TableRow[];
}

const SOURCES = new WeakMap<WorkbookView["table"], RowSource>();

/** One memoized source per projected table object, so callers may ask per render. */
export function rowSource(table: WorkbookView["table"]): RowSource {
  const existing = SOURCES.get(table);
  if (existing) return existing;
  const created = inMemoryRows(table);
  SOURCES.set(table, created);
  return created;
}

function inMemoryRows(table: WorkbookView["table"]): RowSource {
  let indexed: { rows: readonly TableRow[]; length: number; positions: Map<string, number> } | null = null;
  const indexOf = (entity: string): number => {
    if (!indexed || indexed.rows !== table.rows || indexed.length !== table.rows.length) {
      indexed = { rows: table.rows, length: table.rows.length, positions: entityIndex(table.rows) };
    }
    return indexed.positions.get(entity) ?? -1;
  };
  return {
    get total() {
      return table.rows.length;
    },
    rowAt: (index) => table.rows[index],
    rows(start, count) {
      const all = table.rows;
      if (count <= 0 || start >= all.length) return [];
      const from = Math.max(0, start);
      return all.slice(from, from + count);
    },
    byEntity(entity) {
      const index = indexOf(entity);
      return index < 0 ? undefined : table.rows[index];
    },
    indexOf,
    loaded: () => true,
    allRowsForNow: () => table.rows,
  };
}

/** First position wins if a projection ever repeats an entity. */
function entityIndex(rows: readonly TableRow[]): Map<string, number> {
  const index = new Map<string, number>();
  rows.forEach((row, position) => {
    const entity = rowEntity(row);
    if (!index.has(entity)) index.set(entity, position);
  });
  return index;
}
