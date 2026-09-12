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
} from "../../public/core-kit/experimental-client.js";
import {
  UnknownOperationOutcomeError,
  type CoreKit,
  type FieldTarget,
  type KitLoader,
  type ScalarEdit,
  type SheetRuntime,
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
  constructor(cause: unknown) {
    super("The new work opened, but its current projection could not be confirmed.", { cause });
    this.name = "OpenedProjectionRecoveryError";
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
        throw new OpenedProjectionRecoveryError(error);
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
      return openSession(kit, client, requestedAt, async () => {
        const transfer = await kit.projectTransferFromFiles(files);
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
      return openSession(kit, client, requestedAt, () => client.openCanonicalTree(files));
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

  return { openFiles, openCanonical, read, readFields, edit, exportCanonical, close };
}
