// Acceptance observers only: reconstruct public table replies after scalar publications.
export async function installPublishedTablePatcher(context) {
  await context.addInitScript(() => {
    window.__observerGaps = 0;
    window.__patchObservedTable = (last, publication, display) => {
      if (publication.many || !Array.isArray(publication.changed)) return undefined;
      if (!last) return undefined;
      const table = structuredClone(last);
      for (const change of publication.changed) {
        const row = table.rows.find(row => row.id === change.target.entity);
        const fieldId = change.target.field;
        if (!row || !table.columns.some(column => column.id === fieldId) ||
          (!row.fields.some(field => field.target.field === fieldId) && !row.blank_fields?.includes(fieldId))) return null;
        const fields = new Map(row.fields.map(field => [field.target.field, field]));
        if (change.blank === true) fields.delete(fieldId);
        else {
          const field = structuredClone(change);
          if (!display) delete field.display;
          fields.set(fieldId, field);
        }
        row.fields = table.columns.flatMap(column => fields.has(column.id) ? [fields.get(column.id)] : []);
        const blanks = table.columns.filter(column => !fields.has(column.id)).map(column => column.id);
        if (blanks.length) row.blank_fields = blanks;
        else delete row.blank_fields;
      }
      table.revision = publication.resulting_revision;
      return table;
    };
    window.__trackObservedTable = (record, table, display = false) => {
      record.lastTable = table;
      record.tableDisplay = display;
      for (const gap of record.gaps ?? []) {
        if (gap.resolved || gap.publication.resulting_revision !== table.revision) continue;
        if (!gap.publication.changed.every(change => {
          const row = table.rows.find(row => row.id === change.target.entity);
          return row && table.columns.some(column => column.id === change.target.field) &&
            (row.fields.some(field => field.target.field === change.target.field) || row.blank_fields?.includes(change.target.field));
        })) continue;
        gap.resolved = true;
        window.__observerGaps--;
      }
      return table;
    };
    window.__trackPublished = (record, publication) => {
      const table = window.__patchObservedTable(record.lastTable, publication, record.tableDisplay);
      if (table === null) {
        window.__observerGaps++;
        (record.gaps ??= []).push({ publication: structuredClone(publication), resolved: false });
      } else if (table) record.lastTable = table;
      return table;
    };
  });
}
