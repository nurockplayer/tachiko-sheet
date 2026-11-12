import type { FieldProjection, TableProjection } from "../../public/core-kit/experimental-client.js";

/**
 * Patch disposable rows so the patched view deep-equals a reloaded view.
 * Preserve untouched row identities; omit display text as current reloads do.
 */
export function patchTable(table: TableProjection, changed: FieldProjection[]): TableProjection | null {
  const columnIds = table.columns.map(column => column.id);
  const order = new Map(columnIds.map((id, index) => [id, index]));
  if (order.size !== columnIds.length) return null;
  const updates = new Map<string, Map<string, FieldProjection>>();
  for (const field of changed) {
    if (!order.has(field.target.field)) return null;
    let row = updates.get(field.target.entity);
    if (!row) updates.set(field.target.entity, row = new Map());
    const previous = row.get(field.target.field);
    if (previous && !sameValue(previous, field)) return null;
    row.set(field.target.field, field);
  }
  const rows: TableProjection["rows"] = [];
  for (const row of table.rows) {
    const present = new Map(row.fields.map(field => [field.target.field, field]));
    const blanks = row.blank_fields ?? [];
    const ids = [...present.keys(), ...blanks];
    const inOrder = (list: string[]) => list.every((id, index) => order.has(id) &&
      (index === 0 || order.get(list[index - 1]!)! < order.get(id)!));
    if (row.fields.some(field => Object.hasOwn(field, "display") || field.blank === true || field.target.entity !== row.id) ||
      !inOrder(row.fields.map(field => field.target.field)) || !inOrder(blanks) ||
      ids.length !== columnIds.length || new Set(ids).size !== columnIds.length) return null;
    const changes = updates.get(row.id);
    if (!changes) {
      rows.push(row);
      continue;
    }
    for (const [id, field] of changes) {
      if (field.blank === true) present.delete(id);
      else {
        const { display: _display, ...replacement } = field;
        present.set(id, replacement);
      }
    }
    const fields = columnIds.flatMap(id => present.has(id) ? [present.get(id)!] : []);
    const blank_fields = columnIds.filter(id => !present.has(id));
    const { blank_fields: _oldBlanks, ...rest } = row;
    rows.push({ ...rest, fields, ...(blank_fields.length ? { blank_fields } : {}) });
    updates.delete(row.id);
  }
  return updates.size === 0 ? { ...table, rows } : null;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  return Array.isArray(a) === Array.isArray(b) && Object.keys(left).length === Object.keys(right).length &&
    Object.keys(left).every(key => Object.hasOwn(right, key) && sameValue(left[key], right[key]));
}
