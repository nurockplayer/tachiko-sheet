import { describe, expect, it, vi } from "vitest";
import type { TableRowProjection, TableWindowProjection } from "../../public/core-kit/runtime/protocol.js";
import { TableWindowStore, WindowStoreIncoherent } from "./table-window-store.js";

function row(index: number): TableRowProjection {
  return { id: `entity-${index}`, key: `row-${index}`, fields: [] };
}

function reply(start: number, count: number, total = 600): TableWindowProjection {
  return {
    revision: "rev-1",
    collection: { key: "collection-1" },
    total_rows: total,
    start,
    rows: Array.from({ length: Math.min(count, total - start) }, (_, offset) => row(start + offset))
  } as TableWindowProjection;
}

function makeStore(
  fetch: (start: number, count: number) => Promise<TableWindowProjection>,
  options: Partial<ConstructorParameters<typeof TableWindowStore>[0]> = {}
): TableWindowStore {
  return new TableWindowStore({
    revision: "rev-1",
    collectionKey: "collection-1",
    total: 600,
    fetch,
    isTooLarge: () => false,
    onChange: vi.fn(),
    ...options
  });
}

describe("TableWindowStore", () => {
  it("loads only the needed page", async () => {
    const fetch = vi.fn(async (start: number, count: number) => reply(start, count));
    const onChange = vi.fn();
    const store = makeStore(fetch, { onChange });

    await store.ensure(0, 10);

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(0, 256);
    expect(store.rowAt(5)).toBeDefined();
    expect(store.rowAt(300)).toBeUndefined();
    expect(store.loaded(300)).toBe(false);
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("loads overlapping pages in ascending order and requests a short last page", async () => {
    const fetch = vi.fn(async (start: number, count: number) => reply(start, count));
    const store = makeStore(fetch);

    await store.ensure(250, 260);

    expect(fetch.mock.calls).toEqual([[0, 256], [256, 256]]);
    await store.ensure(512, 600);
    expect(fetch.mock.calls.at(-1)).toEqual([512, 88]);
  });

  it("shares an in-flight page request", async () => {
    let resolveFetch!: (value: TableWindowProjection) => void;
    const fetch = vi.fn(() => new Promise<TableWindowProjection>(resolve => { resolveFetch = resolve; }));
    const store = makeStore(fetch);

    const first = store.ensure(0, 10);
    const second = store.ensure(5, 20);
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledOnce();
    resolveFetch(reply(0, 256));
    await Promise.all([first, second]);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("splits query_too_large windows and joins rows in order", async () => {
    const calls: Array<[number, number]> = [];
    const fetch = vi.fn(async (start: number, count: number) => {
      calls.push([start, count]);
      if (count > 128) throw new Error("too large");
      return reply(start, count);
    });
    const store = makeStore(fetch, { isTooLarge: () => true });

    await store.ensure(0, 1);

    expect(calls).toEqual([[0, 256], [0, 128], [128, 128]]);
    expect(store.rowAt(0)).toMatchObject({ id: "entity-0" });
    expect(store.rowAt(255)).toMatchObject({ id: "entity-255" });

    const single = makeStore(async () => { throw new Error("too large"); }, { total: 1, isTooLarge: () => true });
    await expect(single.ensure(0, 1)).rejects.toThrow("too large");
  });

  it.each([
    ["revision", (value: TableWindowProjection) => ({ ...value, revision: "rev-2" })],
    ["collection key", (value: TableWindowProjection) => ({ ...value, collection: { key: "other" } })],
    ["total", (value: TableWindowProjection) => ({ ...value, total_rows: 599 })],
    ["start", (value: TableWindowProjection) => ({ ...value, start: 1 })],
    ["row count", (value: TableWindowProjection) => ({ ...value, rows: value.rows.slice(1) })]
  ] as const)("rejects an incoherent %s reply without storing rows", async (_name, mutate) => {
    const store = makeStore(async (start, count) => mutate(reply(start, count)) as TableWindowProjection);

    await expect(store.ensure(0, 10)).rejects.toBeInstanceOf(WindowStoreIncoherent);
    expect(store.loaded(0)).toBe(false);
  });

  it("evicts least recently ensured pages while retaining a recently ensured page", async () => {
    const fetch = vi.fn(async (start: number, count: number) => reply(start, count, 1024));
    const store = makeStore(fetch, { total: 1024, maxPages: 2 });

    await store.ensure(0, 1);
    await store.ensure(256, 257);
    await store.ensure(512, 513);
    expect(store.loaded(0)).toBe(false);
    expect(store.loaded(256)).toBe(true);

    await store.ensure(256, 257);
    await store.ensure(768, 769);
    expect(store.loaded(256)).toBe(true);
    expect(store.loaded(512)).toBe(false);
  });

  it("drops an in-flight reply after dispose", async () => {
    let resolveFetch!: (value: TableWindowProjection) => void;
    const fetch = vi.fn(() => new Promise<TableWindowProjection>(resolve => { resolveFetch = resolve; }));
    const onChange = vi.fn();
    const store = makeStore(fetch, { onChange });
    const ensuring = store.ensure(0, 10);
    await Promise.resolve();
    store.dispose();
    resolveFetch(reply(0, 256));
    await ensuring;

    expect(store.loaded(0)).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("finds loaded entities without fetching", async () => {
    const fetch = vi.fn(async (start: number, count: number) => reply(start, count));
    const store = makeStore(fetch);

    await store.ensure(0, 10);

    expect(store.indexOfLoaded("entity-5")).toBe(5);
    expect(store.indexOfLoaded("entity-300")).toBe(-1);
    expect(fetch).toHaveBeenCalledOnce();
  });
});
