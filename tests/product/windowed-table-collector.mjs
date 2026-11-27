export const WORK_FIELD_CELL = "td[data-work-field]";

// Runs entirely in the page: Playwright and the packaged WebKit harness use
// the same DOM-only reader. No runtime calls or product windowing internals.
// `draftRows` is 1 when the table shows its new-row line, which the grid counts in aria-rowcount.
export async function collectWindowedRows({ rowCount, columnCount, cellSelector, draftRows = 0, timeoutMs = 60_000 }) {
  const records = new Map();
  // Bound the whole read below the shortest packaged caller's 240 s budget.
  // The per-batch deadline alone allowed hundreds of slow batches to run forever.
  const started = performance.now();
  const collectionDeadline = started + 210_000;
  let batches = 0;
  const pause = () => new Promise(resolve => setTimeout(resolve, 25));
  const missing = () => Array.from({ length: rowCount }, (_, index) => index).filter(index => !records.has(index));
  const table = () => document.querySelector('table[aria-label="Table"]');

  while (records.size < rowCount) {
    const first = missing()[0];
    const deadline = Math.min(collectionDeadline, performance.now() + timeoutMs);
    let previous;
    let settledSince;
    let lastRange = [];
    let lastFacts = null;
    let settleResets = 0;
    for (;;) {
      if (performance.now() >= deadline) {
        throw new Error(`Full-table collection timed out: records collected=${records.size}/${rowCount}; first missing row (0-based)=${first}; batches=${batches}; elapsedMs=${Math.round(performance.now() - started)}; settleResets=${settleResets}; settledMs=${previous ? Math.round(performance.now() - settledSince) : 0}; last rendered indices: ${lastRange.join(", ")}; last readiness facts: ${JSON.stringify(lastFacts)}`);
      }
      const grid = table();
      const scroller = grid?.closest(".ts-grid-scroll");
      const rendered = [...(grid?.querySelectorAll("tbody tr.ts-row") ?? [])];
      const heights = rendered.map(row => row.offsetHeight).filter(height => height > 0).sort((a, b) => a - b);
      const pitch = heights[Math.floor(heights.length / 2)];
      if (!scroller || !pitch) {
        lastFacts = { phase: "geometry", grid: Boolean(grid), scroller: Boolean(scroller), pitch };
        previous = undefined;
        await pause(); continue;
      }

      // Fit a batch inside the viewport and centre it. Merely finding a row
      // isn't enough: an edited/focused row can be pinned outside the window.
      const header = grid.querySelector("thead")?.getBoundingClientRect().height ?? 0;
      const batchSize = Math.max(1, Math.floor((scroller.clientHeight - header) / pitch) - 2);
      const last = Math.min(rowCount - 1, first + batchSize - 1);
      const centre = Math.floor((first + last) / 2);
      const desiredTop = Math.max(0, Math.min(scroller.scrollHeight - scroller.clientHeight,
        header + (centre + 0.5) * pitch - scroller.clientHeight / 2));
      if (Math.abs(scroller.scrollTop - desiredTop) > 1) {
        lastFacts = { phase: "scroll", first, centre, scrollTop: scroller.scrollTop, desiredTop, pitch };
        scroller.scrollTop = desiredTop;
        scroller.dispatchEvent(new Event("scroll"));
        previous = undefined;
        await pause();
        continue;
      }

      // Validate coverage and read in one synchronous DOM snapshot so a window
      // replacement cannot happen between the readiness check and the read.
      const rows = new Map();
      for (const row of rendered) {
        const index = Number(row.getAttribute("aria-rowindex")) - 2;
        if (!Number.isInteger(index) || index < 0 || index >= rowCount || rows.has(index)) {
          throw new Error(`Invalid or duplicate rendered row index: ${index}`);
        }
        rows.set(index, row);
      }
      lastRange = [...rows.keys()];
      const centreBox = rows.get(centre)?.getBoundingClientRect();
      const portTop = scroller.getBoundingClientRect().top + scroller.clientTop;
      // Read the contiguous rendered tail as well as the viewport batch. It
      // must pass the same cell-count, value/target and node-stability checks.
      // Never jump a gap to collect an isolated pinned active/editor row.
      let readLast = last;
      while (readLast + 1 < rowCount && rows.has(readLast + 1)) readLast++;
      const covered = Array.from({ length: readLast - first + 1 }, (_, offset) => rows.get(first + offset));
      const totalsRows = grid.querySelectorAll("tr.ts-totals-row").length;
      lastFacts = { phase: "readiness", centre, readLast,
        scrollTop: scroller.scrollTop, scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight, header, pitch,
        portTop, centreTop: centreBox?.top, centreBottom: centreBox?.bottom,
        rowcount: grid.getAttribute("aria-rowcount"), expectedRowcount: rowCount + 1 + draftRows + totalsRows,
        totalsRows, tfootHeight: grid.querySelector("tfoot")?.getBoundingClientRect().height,
        busy: grid.getAttribute("aria-busy"),
        projectBusy: document.querySelector('[data-testid="project-ready"]')?.getAttribute("aria-busy"),
        centreVisible: Boolean(centreBox && centreBox.top >= portTop + header - 1 && centreBox.bottom <= portTop + scroller.clientHeight + 1),
        covered: covered.map(row => row?.querySelectorAll(cellSelector).length ?? null) };
      const ready = lastFacts.busy === "false" && lastFacts.projectBusy === "false" &&
        Number(lastFacts.rowcount) === lastFacts.expectedRowcount && lastFacts.centreVisible &&
        lastFacts.covered.every(count => count === columnCount);
      if (!ready) {
        previous = undefined; await pause(); continue;
      }

      const snapshot = covered.map((row, offset) => [first + offset,
        [...row.querySelectorAll(cellSelector)].map(cell => ({ text: cell.textContent, target: cell.getAttribute("data-testid") }))]);
      const signature = JSON.stringify([scroller.scrollTop, lastRange, snapshot]);
      lastFacts.phase = "settle";
      if (previous?.signature === signature && covered.every((row, index) => row === previous.nodes[index])) {
        if (performance.now() - settledSince >= 50) {
          // Overlapping/pinned rows never overwrite earlier independent reads.
          for (const [index, cells] of snapshot) if (!records.has(index)) records.set(index, cells);
          batches++;
          break;
        }
      } else {
        settleResets++;
        settledSince = performance.now();
        previous = { signature, nodes: covered };
      }
      await pause();
    }
  }
  return [...records];
}
