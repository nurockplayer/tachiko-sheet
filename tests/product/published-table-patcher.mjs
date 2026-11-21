// Acceptance observers only: reconstruct public table replies after scalar publications.
export async function installPublishedTablePatcher(context) {
  await context.addInitScript(() => {
    window.__observerGaps = 0;
    window.__patchObservedTable = (last, publication, display) => {
      if (publication.many || !Array.isArray(publication.changed)) return undefined;
      if (!last) return undefined;
      const table = { ...last, rows: [...last.rows] };
      const rowIndices = new Map(table.rows.map((row, index) => [row.id, index]));
      const columnIds = new Set(table.columns.map(column => column.id));
      const changesByEntity = new Map();
      for (const change of publication.changed) {
        const entity = change.target.entity;
        if (!rowIndices.has(entity) || !columnIds.has(change.target.field)) return null;
        if (!changesByEntity.has(entity)) changesByEntity.set(entity, []);
        changesByEntity.get(entity).push(change);
      }
      for (const [entity, changes] of changesByEntity) {
        const index = rowIndices.get(entity);
        const row = { ...table.rows[index] };
        const fields = new Map(row.fields.map(field => [field.target.field, field]));
        const firstField = changes[0].target.field;
        if (!fields.has(firstField) && !row.blank_fields?.includes(firstField)) return null;
        // After the first change, every absent column is an observed blank.
        for (const change of changes) {
          const fieldId = change.target.field;
          if (change.blank === true) fields.delete(fieldId);
          else {
            const field = structuredClone(change);
            if (!display) delete field.display;
            fields.set(fieldId, field);
          }
        }
        row.fields = table.columns.flatMap(column => fields.has(column.id) ? [fields.get(column.id)] : []);
        const blanks = table.columns.filter(column => !fields.has(column.id)).map(column => column.id);
        if (blanks.length) row.blank_fields = blanks;
        else delete row.blank_fields;
        table.rows[index] = row;
      }
      table.revision = publication.resulting_revision;
      return table;
    };
    window.__trackObservedTable = (record, table, display = false) => {
      record.lastTable = table;
      record.tableDisplay = display;
      for (const gap of record.gaps ?? []) {
        if (gap.resolved || gap.collection !== table.collection.id) continue;
        // Resident revisions are monotonic counters, not lexically ordered strings.
        if (BigInt(table.revision.slice("resident/".length)) <
            BigInt(gap.publication.resulting_revision.slice("resident/".length))) continue;
        gap.resolved = true;
        window.__observerGaps--;
      }
      record.stale = (record.gaps ?? []).some(gap => !gap.resolved);
      return table;
    };
    window.__readObservedTable = record => {
      if (record?.stale) {
        const summary = record.gaps.filter(gap => !gap.resolved).map(gap =>
          `${gap.publication.resulting_revision} (${gap.publication.changed.length} changed targets)`).join(", ");
        throw new Error(`observer stale: ${summary}`);
      }
      return record?.lastTable;
    };
    window.__trackPublished = (record, publication) => {
      const table = window.__patchObservedTable(record.lastTable, publication, record.tableDisplay);
      if (table === null) {
        window.__observerGaps++;
        record.stale = true;
        (record.gaps ??= []).push({ collection: record.lastTable.collection.id,
          publication: structuredClone(publication), resolved: false });
      } else if (table) record.lastTable = table;
      return table;
    };
  });
}
