import type { FieldProjection, TableProjection } from "../../public/core-kit/experimental-client.js";

/** Replace complete cell projections while preserving untouched row identities. */
export function patchTable(table: TableProjection, changed: FieldProjection[]): TableProjection | null {
  const updates = new Map<string, Map<string, FieldProjection>>();
  for (const field of changed) {
    let row = updates.get(field.target.entity);
    if (!row) updates.set(field.target.entity, row = new Map());
    const previous = row.get(field.target.field);
    if (previous && !sameValue(previous, field)) return null;
    row.set(field.target.field, field);
  }
  const rows = table.rows.map(row => {
    const fields = updates.get(row.id);
    if (!fields) return row;
    const replacements = row.fields.map(field => {
      const replacement = fields.get(field.target.field);
      fields.delete(field.target.field);
      return replacement ?? field;
    });
    if (fields.size === 0) updates.delete(row.id);
    return { ...row, fields: replacements };
  });
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
