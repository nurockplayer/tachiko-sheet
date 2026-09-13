/**
 * Bounded Sheet runtime adapter over the intact public core-kit entry.
 *
 * Owns exactly one resident public client. It keeps only opaque occurrence
 * scope/revision plus the current collection handle; every returned
 * WorkbookView is a disposable projection rebuilt from actual core calls.
 * Rust/core stays the sole authority for meaning, validation and publication.
 */
import type {
  CanonicalProjectFile,
  OpenedProjection,
  PublicationProjection,
  TableProjection,
} from "../../public/core-kit/experimental-client.js";
import type { KeyedGroupedSumProjection } from "../../public/core-kit/runtime/protocol.js";
import type {
  CleanupOperation,
  ImportOptions,
  ImportSelection,
  InteropMetadata,
  SpreadsheetFormat,
} from "../../public/core-kit/runtime/interop-protocol.js";
import {
  UnknownOperationOutcomeError,
  type CoreKit,
  type FieldTarget,
  type KitLoader,
  type ScalarEdit,
  type SheetRuntime,
  type ImportedWorkbook,
  type KeyedGroupedSumBindingCatalog,
  type KeyedGroupedSumBindingChoice,
  type KeyedGroupedSumResult,
  type OpaqueProjectExport,
  type ViewWitness,
  type WorkbookView,
} from "../contracts.js";

export type SheetSessionErrorCode =
  | "not-open"
  | "closed"
  | "stale-witness"
  | "session-replaced"
  | "incoherent-reply";

/**
 * A local refusal or an invalidated reply. Nothing here claims a semantic
 * result: either no request was dispatched, or a dispatched reply arrived
 * after the session it belonged to was closed/replaced and was discarded.
 */
export class SheetSessionError extends Error {
  readonly code: SheetSessionErrorCode;

  constructor(code: SheetSessionErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SheetSessionError";
    this.code = code;
  }
}

/** Publication succeeded, but its replacement projection could not be confirmed. */
export class PublishedProjectionRecoveryError extends Error {
  readonly publication: PublicationProjection;

  constructor(publication: PublicationProjection, cause: unknown) {
    super("The change was published, but the current work could not be confirmed.", { cause });
    this.name = "PublishedProjectionRecoveryError";
    this.publication = publication;
  }
}

/** Open replaced the resident work, but its first projection was not coherent. */
export class OpenedProjectionRecoveryError extends Error {
  readonly operationOutcome: "opened" | "unknown";

  constructor(cause: unknown, operationOutcome: "opened" | "unknown" = "opened") {
    super(
      operationOutcome === "unknown"
        ? "The open request outcome is unknown; its current projection could not be confirmed."
        : "The new work opened, but its current projection could not be confirmed.",
      { cause },
    );
    this.name = "OpenedProjectionRecoveryError";
    this.operationOutcome = operationOutcome;
  }
}

/** Refresh proved that an unknown open left no resident project available. */
export class NoResidentWorkError extends Error {
  constructor(cause: unknown) {
    super("No resident work is available.", { cause });
    this.name = "NoResidentWorkError";
  }
}

type PublicClient = ReturnType<CoreKit["createExperimentalDesignerClient"]>;
type ReadyKit = { kit: CoreKit; client: PublicClient };

/** Opaque handles for the live occurrence; not a mirror of document state. */
interface ActiveWork {
  scope: string;
  revision: string;
  collection: string;
}

interface CoherentRead {
  view: WorkbookView;
  collection: string;
}

const COHERENT_READ_ATTEMPTS = 3;

const noop = (): void => undefined;

export function createSheetRuntime(loadKit: KitLoader): SheetRuntime {
  let ready: Promise<ReadyKit> | null = null;
  let tail: Promise<unknown> = Promise.resolve();
  let active: ActiveWork | null = null;
  let residentCollection: string | null = null;
  let residentAvailable = false;
  let closed = false;
  let epoch = 0;

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = tail.then(task, task);
    tail = run.then(noop, noop);
    return run;
  }

  function loadKitOnce(): Promise<ReadyKit> {
    if (ready === null) {
      ready = loadKit().then((kit) => ({
        kit,
        client: kit.createExperimentalDesignerClient(),
      }));
    }
    return ready;
  }

  function session(): ActiveWork {
    if (closed) {
      throw new SheetSessionError("closed", "The sheet session is closed.");
    }
    if (active === null) {
      throw new SheetSessionError("not-open", "No workbook is open.");
    }
    return active;
  }

  function resident(): string | null {
    if (closed) throw new SheetSessionError("closed", "The sheet session is closed.");
    if (!residentAvailable) throw new SheetSessionError("not-open", "No workbook is open.");
    return residentCollection;
  }

  function assertNotReplaced(expected: number): void {
    if (expected !== epoch) {
      throw new SheetSessionError(
        "session-replaced",
        "The sheet session changed before the reply could be used.",
      );
    }
  }

  function assertUsable(expected: number): void {
    if (closed) {
      throw new SheetSessionError("closed", "The sheet session closed before the reply could be used.");
    }
    assertNotReplaced(expected);
  }

  async function afterUsable<T>(expected: number, pending: Promise<T>): Promise<T> {
    const value = await pending;
    assertUsable(expected);
    return value;
  }

  async function afterNotReplaced<T>(expected: number, pending: Promise<T>): Promise<T> {
    const value = await pending;
    assertNotReplaced(expected);
    return value;
  }

  function classify(kit: CoreKit, cause: unknown): Error {
    if (typeof kit.DesignerRuntimeError === "function" && cause instanceof kit.DesignerRuntimeError) {
      return cause;
    }
    if (cause instanceof UnknownOperationOutcomeError || cause instanceof SheetSessionError) {
      return cause;
    }
    return new UnknownOperationOutcomeError(
      "The runtime did not report a trustworthy result for the dispatched operation.",
      { cause },
    );
  }

  function isNoProject(kit: CoreKit, error: unknown): boolean {
    return typeof kit.DesignerRuntimeError === "function" && error instanceof kit.DesignerRuntimeError
      && (error as { failure?: { code?: string } }).failure?.code === "no_project";
  }

  async function dispatch<T>(kit: CoreKit, call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (cause) {
      throw classify(kit, cause);
    }
  }

  function requireWitness(witness: ViewWitness): ActiveWork {
    const live = session();
    if (witness.occurrence !== live.scope || witness.revision !== live.revision) {
      throw new SheetSessionError(
        "stale-witness",
        "The witness does not match the live occurrence and revision.",
      );
    }
    return live;
  }

  async function loadCoherentView(
    kit: CoreKit,
    client: PublicClient,
    expected: number,
    collection: string | null,
  ): Promise<CoherentRead> {
    for (let attempt = 1; ; attempt += 1) {
      const occurrence = await afterUsable(expected, dispatch(kit, () => client.observeOccurrence()));
      const bootstrap = await afterUsable(expected, dispatch(kit, () => client.bootstrap()));
      if (bootstrap.revision !== occurrence.revision) {
        if (attempt >= COHERENT_READ_ATTEMPTS) {
          throw new SheetSessionError("incoherent-reply", "Core did not return one coherent revision.");
        }
        continue;
      }
      const key = collection ?? bootstrap.default_collection;
      const table = await afterUsable(expected, dispatch(kit, () => client.queryTable(key)));
      if (table.revision !== occurrence.revision) {
        if (attempt >= COHERENT_READ_ATTEMPTS) {
          throw new SheetSessionError("incoherent-reply", "Core did not return one coherent revision.");
        }
        continue;
      }
      return {
        collection: key,
        view: {
          title: bootstrap.title,
          occurrence: occurrence.scope,
          revision: occurrence.revision,
          collections: bootstrap.collections,
          table,
        },
      };
    }
  }

  function dispatchScalarEdit(
    client: PublicClient,
    expectedRevision: string,
    target: FieldTarget,
    edit: ScalarEdit,
  ): Promise<PublicationProjection> {
    switch (edit.kind) {
      case "number":
        return client.editNumber(expectedRevision, target, edit.input);
      case "text":
        return client.editText(expectedRevision, target, edit.value);
      case "boolean":
        return client.editBoolean(expectedRevision, target, edit.value);
      case "date":
        return client.editDate(expectedRevision, target, edit.value);
    }
  }

  function capability<T>(value: T | undefined, name: string): T {
    if (value === undefined) throw new Error(`The installed public core kit does not provide ${name}.`);
    return value;
  }

  function asKeyedGroupedSumResult(result: KeyedGroupedSumProjection): KeyedGroupedSumResult {
    return {
      definitionId: result.definition_id,
      revision: result.revision,
      groups: result.groups,
      diagnostics: result.diagnostics,
    };
  }

  function requireCurrentProjectionRevision(revision: string, actual: string, label: string): void {
    if (actual !== revision) {
      throw new SheetSessionError("incoherent-reply", `The ${label} does not match the live revision.`);
    }
  }

  async function bindingCatalog(
    kit: CoreKit,
    client: PublicClient,
    expected: number,
    revision: string,
  ): Promise<{ catalog: KeyedGroupedSumBindingCatalog; tables: Map<string, TableProjection> }> {
    const bootstrap = await afterUsable(expected, dispatch(kit, () => client.bootstrap()));
    requireCurrentProjectionRevision(revision, bootstrap.revision, "binding catalog");
    const tables = new Map<string, TableProjection>();
    for (const collection of bootstrap.collections) {
      const table = await afterUsable(expected, dispatch(kit, () => client.queryTable(collection.key)));
      requireCurrentProjectionRevision(revision, table.revision, `table ${collection.key}`);
      tables.set(collection.key, table);
    }
    return {
      catalog: {
        collections: bootstrap.collections.map((collection) => {
          const table = tables.get(collection.key);
          if (!table) throw new SheetSessionError("incoherent-reply", "A core collection was not returned.");
          return {
            key: collection.key,
            fields: table.columns.map((column) => ({ key: column.key, fieldType: column.field_type })),
          };
        }),
      },
      tables,
    };
  }

  function selectedTable(tables: Map<string, TableProjection>, key: string): TableProjection {
    const table = tables.get(key);
    if (!table) throw new SheetSessionError("incoherent-reply", `The selected table “${key}” is no longer available.`);
    return table;
  }

  function selectedField(table: TableProjection, key: string): string {
    const column = table.columns.find((candidate) => candidate.key === key);
    if (!column) throw new SheetSessionError("incoherent-reply", `The selected field “${key}” is no longer available.`);
    return column.id;
  }

  function newDefinitionId(): string {
    const create = globalThis.crypto?.randomUUID;
    if (typeof create !== "function") throw new Error("This host cannot create a private grouped-summary identifier.");
    return create.call(globalThis.crypto);
  }

  async function openSession(
    kit: CoreKit,
    client: PublicClient,
    expected: number,
    dispatchOpen: () => Promise<OpenedProjection>,
  ): Promise<WorkbookView> {
    try {
      await afterNotReplaced(expected, dispatch(kit, dispatchOpen));
    } catch (error) {
      if (error instanceof UnknownOperationOutcomeError) {
        // The open may have replaced the resident core work; the old
        // projection is never safe to retain after an unknown reply.
        active = null;
        residentCollection = null;
        residentAvailable = true;
        closed = false;
        throw new OpenedProjectionRecoveryError(error, "unknown");
      }
      throw error;
    }
    // The successful open replaced the resident occurrence even before its
    // projection is coherent; invalidate every old witness immediately.
    active = null;
    residentCollection = null;
    residentAvailable = true;
    closed = false;
    let read: CoherentRead;
    try {
      read = await loadCoherentView(kit, client, expected, null);
    } catch (error) {
      throw new OpenedProjectionRecoveryError(error);
    }
    assertNotReplaced(expected);
    active = {
      scope: read.view.occurrence,
      revision: read.view.revision,
      collection: read.collection,
    };
    residentCollection = read.collection;
    return read.view;
  }

  function openFiles(files: FileList): Promise<WorkbookView> {
    const requestedAt = epoch;
    return enqueue(async () => {
      assertNotReplaced(requestedAt);
      const { kit, client } = await loadKitOnce();
      assertNotReplaced(requestedAt);
      const transfer = await kit.projectTransferFromFiles(files);
      return openSession(kit, client, requestedAt, async () => {
        return client.openProject(transfer);
      });
    });
  }

  function openCanonical(files: readonly CanonicalProjectFile[]): Promise<WorkbookView> {
    const requestedAt = epoch;
    return enqueue(async () => {
      assertNotReplaced(requestedAt);
      const { kit, client } = await loadKitOnce();
      assertNotReplaced(requestedAt);
      // Canonical saved copies are admitted before dispatch. A known transfer
      // refusal is pre-dispatch and must preserve the resident occurrence.
      kit.preflightCanonicalProjectEntries(files);
      const transfer = kit.projectTransferFromEntries(files);
      return openSession(kit, client, requestedAt, () => client.openProject(transfer));
    });
  }

  function openOpaque(bytes: ArrayBuffer): Promise<WorkbookView> {
    const requestedAt = epoch;
    return enqueue(async () => {
      assertNotReplaced(requestedAt);
      const { kit, client } = await loadKitOnce();
      assertNotReplaced(requestedAt);
      // The host record is a core-produced opaque transfer. It is cloned for
      // dispatch only; Sheet never parses, relabels, or rebuilds its bytes.
      return openSession(kit, client, requestedAt, () => client.openProject(bytes.slice(0)));
    });
  }

  function read(): Promise<WorkbookView> {
    return enqueue(async () => {
      const collection = resident();
      const expected = epoch;
      const { kit, client } = await loadKitOnce();
      assertUsable(expected);
      let result: CoherentRead;
      try {
        result = await loadCoherentView(kit, client, expected, collection);
      } catch (error) {
        active = null;
        if (isNoProject(kit, error)) {
          residentAvailable = false;
          residentCollection = null;
          closed = true;
          throw new NoResidentWorkError(error);
        }
        throw error;
      }
      assertUsable(expected);
      active = {
        scope: result.view.occurrence,
        revision: result.view.revision,
        collection: result.collection,
      };
      residentCollection = result.collection;
      return result.view;
    });
  }

  function selectCollection(witness: ViewWitness, collection: string): Promise<WorkbookView> {
    return enqueue(async () => {
      const live = requireWitness(witness);
      const expected = epoch;
      const { kit, client } = await loadKitOnce();
      assertUsable(expected);
      const read = await loadCoherentView(kit, client, expected, collection);
      requireCurrentProjectionRevision(live.revision, read.view.revision, "selected table");
      active = { scope: read.view.occurrence, revision: read.view.revision, collection: read.collection };
      residentCollection = read.collection;
      return read.view;
    });
  }

  function readFields(witness: ViewWitness, targets: FieldTarget[]) {
    return enqueue(async () => {
      const live = requireWitness(witness);
      const expected = epoch;
      const { kit, client } = await loadKitOnce();
      assertUsable(expected);
      return afterUsable(expected, dispatch(kit, () => client.queryFields(live.revision, targets)));
    });
  }

  function edit(witness: ViewWitness, target: FieldTarget, change: ScalarEdit): Promise<WorkbookView> {
    return enqueue(async () => {
      const live = requireWitness(witness);
      const expected = epoch;
      const { kit, client } = await loadKitOnce();
      assertUsable(expected);
      let publication: PublicationProjection;
      try {
        publication = await afterUsable(
          expected,
          dispatch(kit, () => dispatchScalarEdit(client, live.revision, target, change)),
        );
      } catch (error) {
        if (error instanceof UnknownOperationOutcomeError) {
          active = null;
          residentCollection = live.collection;
        }
        throw error;
      }
      let result: CoherentRead;
      try {
        result = await loadCoherentView(kit, client, expected, live.collection);
      } catch (error) {
        active = null;
        residentCollection = live.collection;
        throw new PublishedProjectionRecoveryError(publication, error);
      }
      assertUsable(expected);
      active = {
        scope: result.view.occurrence,
        revision: result.view.revision,
        collection: result.collection,
      };
      residentCollection = result.collection;
      return result.view;
    });
  }

  function exportCanonical(witness: ViewWitness) {
    return enqueue(async () => {
      const live = requireWitness(witness);
      const expected = epoch;
      const { kit, client } = await loadKitOnce();
      assertUsable(expected);
      const tree = await afterUsable(expected, dispatch(kit, () => client.exportCanonicalTree(live.revision)));
      if (tree.revision !== live.revision) {
        throw new SheetSessionError(
          "incoherent-reply",
          "The canonical export does not match the pinned revision.",
        );
      }
      return tree;
    });
  }

  function exportOpaque(witness: ViewWitness): Promise<OpaqueProjectExport> {
    return enqueue(async () => {
      const live = requireWitness(witness);
      const expected = epoch;
      const { kit, client } = await loadKitOnce();
      assertUsable(expected);
      const project = await afterUsable(expected, dispatch(kit, () => client.exportProject(live.revision)));
      requireCurrentProjectionRevision(live.revision, project.revision, "opaque project export");
      return { revision: project.revision, bytes: project.bytes.slice(0) };
    });
  }

  function listKeyedGroupedSumBindings(witness: ViewWitness): Promise<KeyedGroupedSumBindingCatalog> {
    return enqueue(async () => {
      const live = requireWitness(witness);
      const expected = epoch;
      const { kit, client } = await loadKitOnce();
      assertUsable(expected);
      return (await bindingCatalog(kit, client, expected, live.revision)).catalog;
    });
  }

  function queryKeyedGroupedSum(witness: ViewWitness, definitionId: string): Promise<KeyedGroupedSumResult> {
    return enqueue(async () => {
      const live = requireWitness(witness);
      const expected = epoch;
      const { kit, client } = await loadKitOnce();
      const query = capability(client.queryKeyedGroupedSum, "keyed grouped-summary query");
      const result = await afterUsable(expected, dispatch(kit, () => query.call(client, definitionId)));
      requireCurrentProjectionRevision(live.revision, result.revision, "grouped summary");
      return asKeyedGroupedSumResult(result);
    });
  }

  function discoverKeyedGroupedSums(witness: ViewWitness): Promise<KeyedGroupedSumResult[]> {
    return enqueue(async () => {
      const live = requireWitness(witness);
      const expected = epoch;
      const { kit, client } = await loadKitOnce();
      const query = capability(client.queryKeyedGroupedSum, "keyed grouped-summary query");
      const bootstrap = await afterUsable(expected, dispatch(kit, () => client.bootstrap()));
      requireCurrentProjectionRevision(live.revision, bootstrap.revision, "grouped-summary discovery");
      const ids = bootstrap.keyed_grouped_sum_definition_ids ?? [];
      const results: KeyedGroupedSumResult[] = [];
      for (const id of ids) {
        const result = await afterUsable(expected, dispatch(kit, () => query.call(client, id)));
        requireCurrentProjectionRevision(live.revision, result.revision, "grouped summary");
        results.push(asKeyedGroupedSumResult(result));
      }
      return results;
    });
  }

  function createKeyedGroupedSum(
    witness: ViewWitness,
    binding: KeyedGroupedSumBindingChoice,
  ): Promise<KeyedGroupedSumResult> {
    return enqueue(async () => {
      const live = requireWitness(witness);
      const expected = epoch;
      const { kit, client } = await loadKitOnce();
      const create = capability(client.createKeyedGroupedSum, "keyed grouped-summary creation");
      const { tables } = await bindingCatalog(kit, client, expected, live.revision);
      const orders = selectedTable(tables, binding.ordersCollection);
      const products = selectedTable(tables, binding.productsCollection);
      let published;
      try {
        published = await afterUsable(expected, dispatch(kit, () => create.call(client, live.revision, {
          id: newDefinitionId(),
          orders_schema: orders.collection.id,
          order_lookup_key_field: selectedField(orders, binding.orderLookupKeyField),
          order_quantity_field: selectedField(orders, binding.orderQuantityField),
          products_schema: products.collection.id,
          product_key_field: selectedField(products, binding.productKeyField),
          product_category_field: selectedField(products, binding.productCategoryField),
          product_price_field: selectedField(products, binding.productPriceField),
        })));
      } catch (error) {
        if (error instanceof UnknownOperationOutcomeError) {
          active = null;
          residentCollection = live.collection;
        }
        throw error;
      }
      let read: CoherentRead;
      try {
        read = await loadCoherentView(kit, client, expected, live.collection);
        requireCurrentProjectionRevision(read.view.revision, published.result.revision, "published grouped summary");
      } catch (error) {
        active = null;
        residentCollection = live.collection;
        throw new PublishedProjectionRecoveryError(published.publication, error);
      }
      active = { scope: read.view.occurrence, revision: read.view.revision, collection: read.collection };
      residentCollection = read.collection;
      return asKeyedGroupedSumResult(published.result);
    });
  }

  function inspectSpreadsheet(bytes: ArrayBuffer, format: SpreadsheetFormat, options: ImportOptions) {
    return enqueue(async () => {
      const { kit, client } = await loadKitOnce();
      const inspect = capability(client.inspectSpreadsheet, "spreadsheet inspection");
      return dispatch(kit, () => inspect.call(client, bytes.slice(0), format, options));
    });
  }

  function importSpreadsheet(
    bytes: ArrayBuffer,
    format: SpreadsheetFormat,
    options: ImportOptions,
    selection: ImportSelection,
  ): Promise<ImportedWorkbook> {
    const requestedAt = epoch;
    return enqueue(async () => {
      assertNotReplaced(requestedAt);
      const { kit, client } = await loadKitOnce();
      const importSheet = capability(client.importSpreadsheet, "spreadsheet import");
      let imported;
      try {
        imported = await afterNotReplaced(
          requestedAt,
          dispatch(kit, () => importSheet.call(client, bytes.slice(0), format, options, selection)),
        );
      } catch (error) {
        if (error instanceof UnknownOperationOutcomeError) {
          active = null;
          residentCollection = null;
          residentAvailable = true;
          closed = false;
          throw new OpenedProjectionRecoveryError(error, "unknown");
        }
        throw error;
      }
      active = null;
      residentCollection = null;
      residentAvailable = true;
      closed = false;
      let read: CoherentRead;
      try {
        read = await loadCoherentView(kit, client, requestedAt, null);
      } catch (error) {
        throw new OpenedProjectionRecoveryError(error);
      }
      active = { scope: read.view.occurrence, revision: read.view.revision, collection: read.collection };
      residentCollection = read.collection;
      return { view: read.view, metadata: imported.metadata, ledger: imported.ledger };
    });
  }

  function previewCleanup(witness: ViewWitness, operation: CleanupOperation) {
    return enqueue(async () => {
      const live = requireWitness(witness);
      const expected = epoch;
      const { kit, client } = await loadKitOnce();
      const preview = capability(client.previewCleanup, "cleanup preview");
      return afterUsable(expected, dispatch(kit, () => preview.call(client, live.revision, operation)));
    });
  }

  function commitCleanup(witness: ViewWitness, previewId: string): Promise<WorkbookView> {
    return enqueue(async () => {
      const live = requireWitness(witness);
      const expected = epoch;
      const { kit, client } = await loadKitOnce();
      const commit = capability(client.commitCleanup, "cleanup commit");
      let publication: PublicationProjection;
      try {
        publication = await afterUsable(expected, dispatch(kit, () => commit.call(client, live.revision, previewId)));
      } catch (error) {
        if (error instanceof UnknownOperationOutcomeError) {
          // The commit might have published. Retain only the resident handle
          // needed for an explicit re-observe, never the old witness.
          active = null;
          residentCollection = live.collection;
        }
        throw error;
      }
      try {
        const read = await loadCoherentView(kit, client, expected, live.collection);
        active = { scope: read.view.occurrence, revision: read.view.revision, collection: read.collection };
        residentCollection = read.collection;
        return read.view;
      } catch (error) {
        active = null;
        residentCollection = live.collection;
        throw new PublishedProjectionRecoveryError(publication, error);
      }
    });
  }

  function exportSpreadsheet(witness: ViewWitness, metadata: InteropMetadata, format: SpreadsheetFormat) {
    return enqueue(async () => {
      const live = requireWitness(witness);
      const expected = epoch;
      const { kit, client } = await loadKitOnce();
      const exportSheet = capability(client.exportSpreadsheet, "spreadsheet export");
      // Interop metadata carries the producer-issued collection/schema
      // identity. The display/query key is not an export substitute.
      const collection = metadata.sheets[0]?.schema_id;
      if (!collection) throw new Error("Imported-source metadata has no exportable sheet identity.");
      return afterUsable(
        expected,
        dispatch(kit, () => exportSheet.call(client, live.revision, metadata, format, collection)),
      );
    });
  }

  function validateImportedProject(files: readonly CanonicalProjectFile[], metadata: InteropMetadata): Promise<void> {
    return enqueue(async () => {
      const { kit, client } = await loadKitOnce();
      const inspect = capability(client.inspectImportedProject, "imported-project inspection");
      // This is deliberately a validation-only call over the same opaque
      // canonical transfer that will immediately be opened below. The source
      // spreadsheet bytes remain a host-private preservation attachment.
      const transfer = kit.projectTransferFromEntries(files);
      await dispatch(kit, () => inspect.call(client, transfer, metadata));
    });
  }

  async function close(): Promise<void> {
    if (closed) {
      return;
    }
    closed = true;
    epoch += 1;
    active = null;
    residentCollection = null;
    residentAvailable = false;
    if (ready === null) {
      return;
    }
    let live: ReadyKit;
    try {
      live = await ready;
    } catch {
      return;
    }
    try {
      await live.client.closeProject();
    } catch (cause) {
      throw classify(live.kit, cause);
    }
  }

  return {
    openFiles, openCanonical, openOpaque, read, selectCollection, readFields, edit, exportCanonical, exportOpaque,
    listKeyedGroupedSumBindings, createKeyedGroupedSum, queryKeyedGroupedSum, discoverKeyedGroupedSums,
    inspectSpreadsheet, importSpreadsheet, previewCleanup, commitCleanup, exportSpreadsheet, validateImportedProject, close,
  };
}
