// Passive, bounded evidence for capacity failures; never changes worker traffic.
export async function observeCapacity(context) {
  await context.addInitScript(() => {
    window.__capacityEvidence = { started: performance.now(), requests: {}, replies: {}, tail: [], errors: [] };
    const evidence = window.__capacityEvidence;
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(...args) {
        super(...args);
        this.addEventListener("message", ({ data }) => {
          const response = data.response;
          const type = response?.type ?? data.type ?? "unknown";
          evidence.replies[type] = (evidence.replies[type] ?? 0) + 1;
          evidence.tail.push({ ms: Math.round(performance.now() - evidence.started), direction: "reply", id: data.id,
            type, error: data.error ?? response?.error,
            capacity: type === "capacity" ? response.payload : undefined,
            start: response?.payload?.start, rows: response?.payload?.rows?.length,
            total: response?.payload?.total_rows });
          evidence.tail = evidence.tail.slice(-16);
        });
      }
      postMessage(data, ...args) {
        const request = data.request ?? data;
        const type = request.type ?? "unknown";
        evidence.requests[type] = (evidence.requests[type] ?? 0) + 1;
        evidence.tail.push({ ms: Math.round(performance.now() - evidence.started), direction: "request", id: data.id,
          type, collection: request.collection, start: request.start, count: request.count,
          expected_revision: request.expected_revision });
        evidence.tail = evidence.tail.slice(-16);
        return super.postMessage(data, ...args);
      }
    };
    window.addEventListener("error", event => evidence.errors.push(event.message));
    window.addEventListener("unhandledrejection", event => evidence.errors.push(String(event.reason)));
  });
  context.on("page", page => page.on("console", message => {
    if (message.type() === "error") console.log(`CAPACITY console: ${message.text().slice(0, 1200)}`);
  }));
}

export async function capacitySnapshot(page, label) {
  console.log("CAPACITY " + JSON.stringify({ label, ...await page.evaluate(() => ({
    elapsedMs: Math.round(performance.now() - window.__capacityEvidence.started),
    status: [...document.querySelectorAll('[role="alert"], [role="status"]')].map(n => n.textContent),
    ready: document.querySelector('[data-testid="project-ready"]')?.getAttribute("aria-busy"),
    gridRows: document.querySelector('table[aria-label="Table"]')?.getAttribute("aria-rowcount"),
    evidence: window.__capacityEvidence,
  })) }));
}
