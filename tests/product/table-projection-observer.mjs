// Read-only evidence: copy actual public Worker table replies. Never dispatch a
// command or replace a reply; ordinary UI actions remain the only writer.
export async function observeTableProjections(context) {
  await context.addInitScript(() => {
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(...args) {
        super(...args);
        this.addEventListener("message", event => {
          if (event.data.response?.type === "table") window.__observedTable = structuredClone(event.data.response.payload);
        });
      }
    };
  });
}

export async function observedTable(page) {
  await page.waitForFunction(() => Boolean(window.__observedTable));
  return page.evaluate(() => window.__observedTable);
}
