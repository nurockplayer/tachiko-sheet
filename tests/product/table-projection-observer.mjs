// Read-only evidence: copy actual public Worker table replies. Never dispatch a
// command or replace a reply; ordinary UI actions remain the only writer.
export async function observeTableProjections(context) {
  await context.addInitScript(() => {
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(...args) {
        super(...args);
        this.addEventListener("message", event => {
          // Working-size scalar edits supply real changed fields rather than
          // re-reading all windows. Retain those received fields as evidence.
          const response = event.data.response;
          const publication = response?.type === "published" ? response.payload : null;
          const table = window.__observedTable;
          if (publication?.changed && !publication.many && table?.revision === publication.base_revision) {
            for (const field of publication.changed) {
              const row = table.rows.find(row => row.id === field.target.entity);
              if (!row) continue;
              row.fields = row.fields.filter(existing => existing.target.field !== field.target.field);
              if (!field.blank) row.fields.push(structuredClone(field));
              row.fields.sort((a, b) => table.columns.findIndex(c => c.id === a.target.field) - table.columns.findIndex(c => c.id === b.target.field));
              const blanks = table.columns.filter(column => !row.fields.some(field => field.target.field === column.id)).map(column => column.id);
              if (blanks.length) row.blank_fields = blanks;
              else delete row.blank_fields;
            }
            table.revision = publication.resulting_revision;
          }
          // Tables above 1,000 rows arrive as unfiltered windows (Work A-03); assemble them.
          if (event.data.response?.type === "table") window.__observedTable = structuredClone(event.data.response.payload);
          if (event.data.response?.type === "table_window") {
            const w = structuredClone(event.data.response.payload);
            if (w.start === 0 || !this.__windowTable || this.__windowTable.revision !== w.revision) this.__windowTable = { ...(w.tracker_profile ? { tracker_profile: true } : {}), ...(w.native_table_profile ? { native_table_profile: true } : {}), revision: w.revision, collection: w.collection, columns: w.columns, rows: [] };
            this.__windowTable.rows.push(...w.rows);
            if (this.__windowTable.rows.length >= w.total_rows) { const assembled = this.__windowTable; this.__windowTable = null; window.__observedTable = assembled; }
          }
        });
      }
    };
  });
}

export async function observedTable(page) {
  await page.waitForFunction(() => Boolean(window.__observedTable));
  return page.evaluate(() => window.__observedTable);
}
