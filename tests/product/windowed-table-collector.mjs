// Runs entirely in the page: Playwright and the packaged WebKit harness use
// the same DOM-only reader. No runtime calls or product windowing internals.
export async function collectWindowedRows({ rowCount, columnCount, timeoutMs = 60_000 }) {
  const records = new Map();
  const pause = () => new Promise(resolve => setTimeout(resolve, 25));
  const missing = () => Array.from({ length: rowCount }, (_, index) => index).filter(index => !records.has(index));
  const table = () => document.querySelector('table[aria-label="Table"]');

  while (records.size < rowCount) {
    const first = missing()[0];
    const deadline = performance.now() + timeoutMs;
    let previous;
    let settledSince;
    let lastRange = [];
    for (;;) {
      if (performance.now() >= deadline) {
        throw new Error(`Full-table collection timed out at row ${first}; missing indices (0-based): ${missing().join(", ")}; last rendered indices: ${lastRange.join(", ")}`);
      }
      const grid = table();
      const scroller = grid?.closest(".ts-grid-scroll");
      const rendered = [...(grid?.querySelectorAll("tbody tr.ts-row") ?? [])];
      const heights = rendered.map(row => row.offsetHeight).filter(height => height > 0).sort((a, b) => a - b);
      const pitch = heights[Math.floor(heights.length / 2)];
      if (!scroller || !pitch) { await pause(); continue; }

      // Fit a batch inside the viewport and centre it. Merely finding a row
      // isn't enough: an edited/focused row can be pinned outside the window.
      const header = grid.querySelector("thead")?.getBoundingClientRect().height ?? 0;
      const batchSize = Math.max(1, Math.min(20, Math.floor((scroller.clientHeight - header) / pitch) - 2));
      const last = Math.min(rowCount - 1, first + batchSize - 1);
      const centre = Math.floor((first + last) / 2);
      const desiredTop = Math.max(0, Math.min(scroller.scrollHeight - scroller.clientHeight,
        header + (centre + 0.5) * pitch - scroller.clientHeight / 2));
      if (Math.abs(scroller.scrollTop - desiredTop) > 1) {
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
      const covered = Array.from({ length: last - first + 1 }, (_, offset) => rows.get(first + offset));
      const ready = grid.getAttribute("aria-busy") === "false" &&
        document.querySelector('[data-testid="project-ready"]')?.getAttribute("aria-busy") === "false" &&
        Number(grid.getAttribute("aria-rowcount")) === rowCount + 1 &&
        centreBox && centreBox.top >= portTop + header - 1 && centreBox.bottom <= portTop + scroller.clientHeight + 1 &&
        covered.every(row => row?.querySelectorAll("td").length === columnCount);
      if (!ready) { previous = undefined; await pause(); continue; }

      const snapshot = covered.map((row, offset) => [first + offset,
        [...row.querySelectorAll("td")].map(cell => ({ text: cell.textContent, target: cell.getAttribute("data-testid") }))]);
      const signature = JSON.stringify([scroller.scrollTop, lastRange, snapshot]);
      if (previous?.signature === signature && covered.every((row, index) => row === previous.nodes[index])) {
        if (performance.now() - settledSince >= 50) {
          // Overlapping/pinned rows never overwrite earlier independent reads.
          for (const [index, cells] of snapshot) if (!records.has(index)) records.set(index, cells);
          break;
        }
      } else {
        settledSince = performance.now();
        previous = { signature, nodes: covered };
      }
      await pause();
    }
  }
  return [...records];
}
