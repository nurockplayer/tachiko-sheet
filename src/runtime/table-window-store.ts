import type { TableRowProjection, TableWindowProjection } from "../../public/core-kit/runtime/protocol.js";

export class WindowStoreIncoherent extends Error {
  constructor(message = "Table window reply does not match the requested revision-pinned window") {
    super(message);
    this.name = "WindowStoreIncoherent";
  }
}

export interface TableWindowStoreOptions {
  revision: string;
  collectionKey: string;
  total: number;
  fetch: (start: number, count: number) => Promise<TableWindowProjection>;
  isTooLarge: (error: unknown) => boolean;
  onChange: () => void;
  pageSize?: number;
  maxPages?: number;
}

interface CachedPage {
  rows: TableRowProjection[];
  usedAt: number;
}

export class TableWindowStore {
  readonly revision: string;
  readonly total: number;
  private readonly options: TableWindowStoreOptions;
  private readonly pageSize: number;
  private readonly maxPages: number;
  private readonly pages = new Map<number, CachedPage>();
  private readonly inFlight = new Map<number, Promise<boolean>>();
  private sequence = 0;
  private fetchQueue: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(options: TableWindowStoreOptions) {
    this.options = options;
    this.revision = options.revision;
    this.total = options.total;
    this.pageSize = options.pageSize ?? 256;
    this.maxPages = options.maxPages ?? 64;
  }

  rowAt(index: number): TableRowProjection | undefined {
    if (!Number.isInteger(index) || index < 0 || index >= this.total) return undefined;
    return this.pages.get(Math.floor(index / this.pageSize))?.rows[index % this.pageSize];
  }

  loaded(index: number): boolean {
    return this.rowAt(index) !== undefined;
  }

  indexOfLoaded(entity: string): number {
    for (const [pageNumber, page] of this.pages) {
      const found = page.rows.findIndex(row => (row.fields[0]?.target.entity ?? row.id) === entity);
      if (found !== -1) return pageNumber * this.pageSize + found;
    }
    return -1;
  }

  async ensure(start: number, end: number): Promise<void> {
    if (this.disposed || this.total <= 0 || end <= start || start >= this.total) return;
    const first = Math.max(0, Math.floor(start / this.pageSize));
    const last = Math.min(Math.ceil(this.total / this.pageSize) - 1, Math.floor((Math.min(end, this.total) - 1) / this.pageSize));
    if (last < first) return;

    const protectedPages = new Set<number>();
    for (let pageNumber = first; pageNumber <= last; pageNumber++) protectedPages.add(pageNumber);
    let stored = false;

    for (let pageNumber = first; pageNumber <= last; pageNumber++) {
      if (this.disposed) return;
      const existing = this.pages.get(pageNumber);
      if (existing) {
        existing.usedAt = ++this.sequence;
        continue;
      }

      let pending = this.inFlight.get(pageNumber);
      if (!pending) {
        pending = this.enqueuePage(pageNumber, protectedPages);
        this.inFlight.set(pageNumber, pending);
        void pending.finally(() => {
          if (this.inFlight.get(pageNumber) === pending) this.inFlight.delete(pageNumber);
        }).catch(() => undefined);
      }
      stored = (await pending) || stored;
    }

    if (stored && !this.disposed) this.options.onChange();
  }

  dispose(): void {
    this.disposed = true;
    this.pages.clear();
  }

  private enqueuePage(pageNumber: number, protectedPages: Set<number>): Promise<boolean> {
    const operation = this.fetchQueue.then(async () => {
      if (this.disposed) return false;
      const start = pageNumber * this.pageSize;
      const count = Math.min(this.pageSize, this.total - start);
      const rows = await this.fetchRange(start, count);
      if (this.disposed) return false;
      this.pages.set(pageNumber, { rows, usedAt: ++this.sequence });
      this.evict(protectedPages);
      return true;
    });
    this.fetchQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async fetchRange(start: number, count: number): Promise<TableRowProjection[]> {
    try {
      const reply = await this.options.fetch(start, count);
      this.validate(reply, start, count);
      return reply.rows;
    } catch (error) {
      if (count > 1 && !(error instanceof WindowStoreIncoherent) && this.options.isTooLarge(error)) {
        const half = Math.floor(count / 2);
        return [
          ...await this.fetchRange(start, half),
          ...await this.fetchRange(start + half, count - half)
        ];
      }
      throw error;
    }
  }

  private validate(reply: TableWindowProjection, start: number, count: number): void {
    if (
      reply.revision !== this.revision ||
      reply.collection.key !== this.options.collectionKey ||
      reply.total_rows !== this.total ||
      reply.start !== start ||
      reply.rows.length !== Math.min(count, this.total - start)
    ) {
      throw new WindowStoreIncoherent();
    }
  }

  private evict(protectedPages: Set<number>): void {
    while (this.pages.size > this.maxPages) {
      let oldestPage: number | undefined;
      let oldestUse = Number.POSITIVE_INFINITY;
      for (const [pageNumber, page] of this.pages) {
        if (!protectedPages.has(pageNumber) && page.usedAt < oldestUse) {
          oldestPage = pageNumber;
          oldestUse = page.usedAt;
        }
      }
      if (oldestPage === undefined) return;
      this.pages.delete(oldestPage);
    }
  }
}
