// Passive, bounded evidence for capacity failures; never changes worker traffic.
export async function observeCapacity(context, { timing = false } = {}) {
  await context.addInitScript(({ timing }) => {
    window.__capacityEvidence = { started: performance.now(), requests: {}, replies: {}, tail: [], errors: [] };
    const evidence = window.__capacityEvidence;
    // Detailed timing is opt-in. Retain reply references only until the step is
    // reported; JSON sizing happens after visibility, outside the measured path.
    const pending = new Map();
    evidence.beginStep = (target) => {
      const step = { start: performance.now(), requests: [], reads: [], visible: null, frame: null };
      evidence.step = step;
      const check = () => {
        if (target.ready && document.querySelector('[data-testid="project-ready"]')?.getAttribute("aria-busy") !== "false") return;
        if (target.saved && !document.querySelector('[data-testid="save-status"]')?.textContent.includes("Saved on this device")) return;
        if (target.status && !document.querySelector('.ts-clipboard-status')?.textContent.includes(target.status)) return;
        if (target.row != null) {
          const row = document.querySelector(`table[aria-label="Table"] tbody tr[aria-rowindex="${target.row + 2}"]`);
          if (!row || (target.cells ?? []).some(([column, value]) => row.querySelectorAll("td")[column]?.textContent.trim() !== String(value))) return;
        }
        step.visible = performance.now();
        observer.disconnect();
        requestAnimationFrame(() => { step.frame = performance.now(); });
      };
      const observer = new MutationObserver(check);
      observer.observe(document, { childList: true, subtree: true, characterData: true, attributes: true });
      step.disconnect = () => observer.disconnect();
      check();
    };
    if (timing) {
      for (const method of ["text", "arrayBuffer"]) {
        const original = Blob.prototype[method];
        Blob.prototype[method] = async function (...args) {
          const step = evidence.step;
          if (!step) return original.apply(this, args);
          const read = { type: `Blob.${method}`, start: performance.now(), bytes: this.size };
          step.reads.push(read);
          try { return await original.apply(this, args); }
          finally { read.end = performance.now(); }
        };
      }
      for (const method of ["readAsText", "readAsArrayBuffer"]) {
        const original = FileReader.prototype[method];
        FileReader.prototype[method] = function (blob, ...args) {
          const step = evidence.step;
          if (step) {
            const read = { type: `FileReader.${method}`, start: performance.now(), bytes: blob.size };
            step.reads.push(read);
            this.addEventListener("loadend", () => { read.end = performance.now(); }, { once: true });
          }
          return original.call(this, blob, ...args);
        };
      }
      const get = IDBObjectStore.prototype.get;
      IDBObjectStore.prototype.get = function (...args) {
        const step = evidence.step;
        const start = performance.now();
        const request = get.apply(this, args);
        if (step) {
          const read = { type: `IndexedDB.get:${this.name}`, start };
          step.reads.push(read);
          request.addEventListener("success", () => { read.end = performance.now(); read.result = request.result; });
          request.addEventListener("error", () => { read.end = performance.now(); });
        }
        return request;
      };
    }
    evidence.pending = pending;
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(...args) {
        super(...args);
        const inFlight = new Map();
        this.__capacityInFlight = inFlight;
        this.addEventListener("message", ({ data }) => {
          const end = performance.now();
          const request = inFlight.get(data.id);
          if (request) {
            request.end = end; request.reply = data;
            inFlight.delete(data.id); pending.delete(request);
          }
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
        const request = data.request ?? data.operation ?? data;
        const type = request.type ?? data.kind ?? "unknown";
        evidence.requests[type] = (evidence.requests[type] ?? 0) + 1;
        evidence.tail.push({ ms: Math.round(performance.now() - evidence.started), direction: "request", id: data.id,
          type, collection: request.collection, start: request.start, count: request.count,
          expected_revision: request.expected_revision });
        evidence.tail = evidence.tail.slice(-16);
        if (timing && evidence.step) {
          const record = { type, start: performance.now() };
          evidence.step.requests.push(record);
          this.__capacityInFlight.set(data.id, record); pending.set(record, true);
        }
        return super.postMessage(data, ...args);
      }
    };
    window.addEventListener("error", event => evidence.errors.push(event.message));
    window.addEventListener("unhandledrejection", event => evidence.errors.push(String(event.reason)));
  }, { timing });
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

// The endpoint is the first matching DOM state, plus its next animation frame.
// Transport intervals include queueing, Work/WASM, clone/delivery and scheduling;
// the post-reply interval is elapsed Sheet work, not a sampled CPU profile.
export async function beginCapacityStep(page, target) {
  await page.evaluate(target => window.__capacityEvidence.beginStep(target), target);
}

export async function finishCapacityStep(page, label) {
  await page.waitForFunction(() => window.__capacityEvidence.step.frame !== null && window.__capacityEvidence.pending.size === 0);
  const split = await page.evaluate(() => {
    const evidence = window.__capacityEvidence, step = evidence.step;
    // JSON envelope plus transferred binary bytes; structured-clone heap size
    // is browser-specific and is not inferred from this transport-size estimate.
    const bytes = value => {
      if (value == null) return 0;
      let binary = 0;
      const json = JSON.stringify(value, (_key, item) => {
        if (item instanceof ArrayBuffer || ArrayBuffer.isView(item)) {
          binary += item.byteLength;
          return { binaryBytes: item.byteLength };
        }
        return item;
      });
      return binary + new TextEncoder().encode(json).length;
    };
    const round = n => Math.round(n * 10) / 10;
    const union = intervals => {
      let end = step.start, total = 0;
      for (const [a, b] of intervals.sort((a, b) => a[0] - b[0])) {
        const finish = Math.min(b, step.visible);
        total += Math.max(0, finish - Math.max(a, end)); end = Math.max(end, finish);
      }
      return total;
    };
    const worker = {}, largeReplies = [];
    for (const request of step.requests) {
      const size = bytes(request.reply);
      const item = worker[request.type] ??= { count: 0, ms: 0, replyBytes: 0, maxReplyBytes: 0, repliesAfterVisible: 0 };
      item.count++; item.ms += request.end - request.start;
      item.replyBytes += size; item.maxReplyBytes = Math.max(item.maxReplyBytes, size);
      if (request.end > step.visible) item.repliesAfterVisible++;
      if (size >= 131072) {
        const payload = request.reply.response?.payload ?? request.reply;
        const parts = Object.entries(payload).map(([key, value]) => ({ key, bytes: bytes(value), ...(Array.isArray(value) ? { count: value.length } : {}) })).sort((a, b) => b.bytes - a.bytes).slice(0, 5);
        const signature = JSON.stringify([request.type, parts.map(p => [p.key, p.count])]);
        const previous = largeReplies.find(r => r.signature === signature);
        if (previous) { previous.count++; previous.maxBytes = Math.max(previous.maxBytes, size); }
        else largeReplies.push({ signature, request: request.type, count: 1, maxBytes: size, parts });
      }
    }
    for (const value of Object.values(worker)) value.ms = round(value.ms);
    const reads = {};
    for (const read of step.reads) {
      const item = reads[read.type] ??= { count: 0, ms: 0, bytes: 0 };
      item.count++; item.ms += (read.end ?? step.visible) - read.start;
      item.bytes += read.bytes ?? bytes(read.result);
    }
    for (const value of Object.values(reads)) value.ms = round(value.ms);
    const workerIntervals = step.requests.map(r => [r.start, r.end]);
    const readIntervals = step.reads.map(r => [r.start, r.end ?? step.visible]);
    const workerMs = union(workerIntervals), readMs = union(readIntervals);
    const busyMs = union([...workerIntervals, ...readIntervals]);
    const lastReply = Math.max(step.start, ...step.requests.filter(r => r.end <= step.visible).map(r => r.end));
    const result = { visibleMs: round(step.visible - step.start), frameMs: round(step.frame - step.start),
      worker, reads, workerUnionBeforeVisibleMs: round(workerMs), readUnionBeforeVisibleMs: round(readMs),
      workerReadOverlapMs: round(workerMs + readMs - busyMs),
      otherElapsedBeforeVisibleMs: round(step.visible - step.start - busyMs),
      sheetAfterLastPreVisibleReplyToVisibleMs: step.requests.some(r => r.end <= step.visible) ? round(step.visible - lastReply) : null,
      sheetAfterLastPreVisibleReplyToFrameMs: step.requests.some(r => r.end <= step.visible) ? round(step.frame - lastReply) : null,
      lastReplyToVisibleMs: step.requests.length ? round(step.visible - Math.max(...step.requests.map(r => r.end))) : null,
      largeReplies: largeReplies.map(({ signature, ...reply }) => reply) };
    step.disconnect(); evidence.step = null;
    return result;
  });
  console.log(`SPLIT ${label} ${JSON.stringify(split)}`);
}
