// Read-only evidence: copy actual public Worker table replies. Never dispatch a
// command or replace a reply; ordinary UI actions remain the only writer.
export async function observeTableProjections(context) {
  await context.addInitScript(() => {
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(...args) {
        super(...args);
        this.addEventListener("message", event => {
          // Tables above 1,000 rows arrive as unfiltered windows (Work A-03); assemble them.
          if (event.data.response?.type === "table") window.__observedTable = structuredClone(event.data.response.payload);
          if (event.data.response?.type === "table_window") {
            const w = structuredClone(event.data.response.payload);
            if (w.start === 0 || !this.__windowTable || this.__windowTable.revision !== w.revision) this.__windowTable = { revision: w.revision, collection: w.collection, columns: w.columns, rows: [] };
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
