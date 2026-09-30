/**
 * Focused unit evidence for the Sheet runtime adapter using a faithful
 * injected public-client fake. This is not acceptance or real-WASM proof.
 */
import { describe, expect, it, vi } from "vitest";
import type {
  BootstrapProjection,
  CanonicalProjectFile,
  CanonicalTreeExport,
  CollectionSummary,
  FailureProjection,
  FieldProjection,
  FieldTarget,
  FieldBatchProjection,
  OccurrenceProjection,
  OpenedProjection,
  PublicationProjection,
  TableProjection,
} from "../../public/core-kit/experimental-client.js";
import { preflightCanonicalProjectEntries as realPreflightCanonicalProjectEntries } from "../../public/core-kit/experimental-client.js";
import type { KeyedGroupedSumDefinitionInput, KeyedGroupedSumProjection } from "../../public/core-kit/runtime/protocol.js";
import {
  UnknownOperationOutcomeError,
  DATE_SUMMARY_UNSUPPORTED_MESSAGE,
  type CoreKit,
  type ViewWitness,
  type WorkbookView,
} from "../contracts.js";
import {
  OpenedProjectionRecoveryError,
  NoResidentWorkError,
  RuntimeStartupError,
  SheetSessionError,
  createSheetRuntime,
} from "./session.js";

const TITLE = "Qualification workbook";
const COLLECTION: CollectionSummary = { id: "col-1", key: "tasks", entity_count: 1 };
const IMPACT: FieldTarget = { entity: "e1", field: "impact" };
const NOTES: FieldTarget = { entity: "e1", field: "notes" };
const FILES = { length: 18, item: () => null } as unknown as FileList;
const CANONICAL_FILES: readonly CanonicalProjectFile[] = [
  { path: "manifest.json", bytes: new ArrayBuffer(2) },
];

class FakeDesignerRuntimeError extends Error {
  readonly failure: FailureProjection;

  constructor(code: string, currentRevision: string) {
    super(code);
    this.name = "DesignerRuntimeError";
    this.failure = { code, message: code, current_revision: currentRevision, diagnostics: [] };
  }
}

interface Hooks {
  openProject?: () => Promise<OpenedProjection>;
  inspectImportedProject?: () => Promise<OpenedProjection>;
  observeOccurrence?: () => Promise<OccurrenceProjection>;
  editNumber?: () => Promise<PublicationProjection>;
  editText?: () => Promise<PublicationProjection>;
  trackerCommand?: () => Promise<PublicationProjection>;
  exportCanonicalTree?: (revision: string) => Promise<CanonicalTreeExport>;
  queryTable?: (collection: string) => Promise<TableProjection>;
  bootstrap?: () => Promise<BootstrapProjection>;
}

function scalarField(
  target: FieldTarget,
  editable: FieldProjection["editable_scalar"],
  stored: FieldProjection["stored"],
): FieldProjection {
  return {
    target,
    address: `${target.entity}.${target.field}`,
    stored,
    formula: null,
    calculated: null,
    diagnostics: [],
    editable_scalar: editable,
  };
}

class FakeClient {
  readonly calls = {
    openProject: [] as ArrayBuffer[],
    inspectImportedProject: [] as Array<{ bytes: ArrayBuffer; metadata: unknown }>,
    bootstrap: 0,
    observeOccurrence: 0,
    queryTable: [] as string[],
    queryFields: [] as Array<{ revision: string; targets: FieldTarget[] }>,
    editNumber: 0,
    editText: 0,
    editBoolean: 0,
    editDate: 0,
    trackerCommand: [] as Array<{ type: "undo" | "redo"; expected_revision: string }>,
    exportCanonicalTree: [] as string[],
    exportProject: [] as string[],
    createKeyedGroupedSum: [] as KeyedGroupedSumDefinitionInput[],
    queryKeyedGroupedSum: [] as string[],
    closeProject: 0,
    close: 0,
  };

  hooks: Hooks = {};

  #open = false;
  noProjectCode = "no_project_open";
  #scope = 0;
  #counter = 0;
  #revision = "r0";
  #undoCount = 0;
  #redoCount = 0;

  get currentRevision(): string { return this.#revision; }

  #requireOpen(): void {
    if (!this.#open) throw new FakeDesignerRuntimeError(this.noProjectCode, this.#revision);
  }

  #requireRevision(revision: string): void {
    if (revision !== this.#revision) {
      throw new FakeDesignerRuntimeError("stale_revision", this.#revision);
    }
  }

  #bump(): string {
    this.#counter += 1;
    this.#revision = `r${this.#counter}`;
    return this.#revision;
  }

  #bootstrap() {
    return {
      title: TITLE,
      revision: this.#revision,
      default_collection: COLLECTION.key,
      collections: [COLLECTION],
    };
  }

  #table(): TableProjection {
    return {
      revision: this.#revision,
      collection: COLLECTION,
      columns: [
        { id: "f1", key: "impact", field_type: "number" },
        { id: "f2", key: "notes", field_type: "text" },
      ],
      rows: [
        {
          id: "e1",
          key: "e1",
          fields: [
            scalarField(IMPACT, "number", { kind: "number", value: 5 }),
            scalarField(NOTES, "text", { kind: "text", value: "seed" }),
          ],
        },
      ],
    };
  }

  #opened(): OpenedProjection {
    this.#open = true;
    this.#scope += 1;
    this.#bump();
    return { bootstrap: this.#bootstrap(), table: this.#table() };
  }

  #publish(target: FieldTarget): PublicationProjection {
    const base = this.#revision;
    this.#bump();
    this.#undoCount = Math.min(64, this.#undoCount + 1);
    this.#redoCount = 0;
    return {
      base_revision: base,
      resulting_revision: this.#revision,
      entities: [target.entity],
      fields: [target],
      affected_calculations: [],
    };
  }

  async trackerCommand(request: { type: "undo" | "redo"; expected_revision: string }): Promise<PublicationProjection> {
    this.calls.trackerCommand.push(request);
    this.#requireOpen();
    const hook = this.hooks.trackerCommand;
    if (hook !== undefined) {
      this.hooks.trackerCommand = undefined;
      return hook();
    }
    this.#requireRevision(request.expected_revision);
    const available = request.type === "undo" ? this.#undoCount : this.#redoCount;
    if (available < 1) throw new FakeDesignerRuntimeError("no_history", this.#revision);
    const base = this.#revision;
    this.#bump();
    if (request.type === "undo") { this.#undoCount -= 1; this.#redoCount += 1; }
    else { this.#redoCount -= 1; this.#undoCount = Math.min(64, this.#undoCount + 1); }
    return { base_revision: base, resulting_revision: this.#revision, entities: [IMPACT.entity], fields: [IMPACT], affected_calculations: [] };
  }

  async openProject(bytes: ArrayBuffer): Promise<OpenedProjection> {
    this.calls.openProject.push(bytes);
    const hook = this.hooks.openProject;
    if (hook !== undefined) {
      this.hooks.openProject = undefined;
      return hook();
    }
    return this.#opened();
  }

  async inspectImportedProject(bytes: ArrayBuffer, metadata: unknown): Promise<OpenedProjection> {
    this.calls.inspectImportedProject.push({ bytes, metadata });
    const hook = this.hooks.inspectImportedProject;
    if (hook !== undefined) {
      this.hooks.inspectImportedProject = undefined;
      return hook();
    }
    // The public imported-project inspection is validation only. It must not
    // install or replace the resident project before openProject succeeds.
    return { bootstrap: this.#bootstrap(), table: this.#table() };
  }

  async bootstrap() {
    this.calls.bootstrap += 1;
    this.#requireOpen();
    if (this.hooks.bootstrap) return this.hooks.bootstrap();
    return this.#bootstrap();
  }

  async observeOccurrence(): Promise<OccurrenceProjection> {
    this.calls.observeOccurrence += 1;
    const hook = this.hooks.observeOccurrence;
    if (hook !== undefined) {
      this.hooks.observeOccurrence = undefined;
      return hook();
    }
    this.#requireOpen();
    return { scope: `scope-${this.#scope}`, revision: this.#revision };
  }

  async queryTable(collection: string): Promise<TableProjection> {
    this.calls.queryTable.push(collection);
    const hook = this.hooks.queryTable;
    if (hook !== undefined) {
      return hook(collection);
    }
    this.#requireOpen();
    return this.#table();
  }

  async queryFields(revision: string, targets: FieldTarget[]): Promise<FieldBatchProjection> {
    this.calls.queryFields.push({ revision, targets });
    this.#requireOpen();
    this.#requireRevision(revision);
    return {
      revision: this.#revision,
      fields: this.#table()
        .rows.flatMap((row) => row.fields)
        .filter((candidate) =>
          targets.some(
            (target) =>
              target.entity === candidate.target.entity && target.field === candidate.target.field,
          ),
        ),
    };
  }

  async editNumber(revision: string, target: FieldTarget, input: string): Promise<PublicationProjection> {
    this.calls.editNumber += 1;
    this.#requireOpen();
    const hook = this.hooks.editNumber;
    if (hook !== undefined) {
      this.hooks.editNumber = undefined;
      return hook();
    }
    this.#requireRevision(revision);
    return this.#publish(target);
  }

  async editText(revision: string, target: FieldTarget, value: string): Promise<PublicationProjection> {
    this.calls.editText += 1;
    this.#requireOpen();
    const hook = this.hooks.editText;
    if (hook !== undefined) {
      this.hooks.editText = undefined;
      return hook();
    }
    this.#requireRevision(revision);
    return this.#publish(target);
  }

  async editBoolean(revision: string, target: FieldTarget): Promise<PublicationProjection> {
    this.calls.editBoolean += 1;
    this.#requireOpen();
    this.#requireRevision(revision);
    return this.#publish(target);
  }

  async editDate(revision: string, target: FieldTarget): Promise<PublicationProjection> {
    this.calls.editDate += 1;
    this.#requireOpen();
    this.#requireRevision(revision);
    return this.#publish(target);
  }

  async exportCanonicalTree(revision: string): Promise<CanonicalTreeExport> {
    this.calls.exportCanonicalTree.push(revision);
    this.#requireOpen();
    const hook = this.hooks.exportCanonicalTree;
    if (hook !== undefined) {
      this.hooks.exportCanonicalTree = undefined;
      return hook(revision);
    }
    this.#requireRevision(revision);
    return { revision: this.#revision, files: [{ path: "manifest.json", bytes: new ArrayBuffer(4) }] };
  }

  async exportProject(revision: string) {
    this.calls.exportProject.push(revision);
    this.#requireOpen();
    this.#requireRevision(revision);
    return { revision: this.#revision, bytes: new Uint8Array([7, 8, 9]).buffer };
  }

  async createKeyedGroupedSum(revision: string, definition: KeyedGroupedSumDefinitionInput) {
    this.#requireOpen();
    this.#requireRevision(revision);
    this.calls.createKeyedGroupedSum.push(definition);
    const publication = this.#publish(IMPACT);
    return {
      publication,
      result: {
        definition_id: definition.id,
        revision: publication.resulting_revision,
        groups: [{ category: "PEN", value: 800 }],
        diagnostics: [],
      } satisfies KeyedGroupedSumProjection,
    };
  }

  async queryKeyedGroupedSum(definitionId: string): Promise<KeyedGroupedSumProjection> {
    this.#requireOpen();
    this.calls.queryKeyedGroupedSum.push(definitionId);
    return { definition_id: definitionId, revision: this.#revision, groups: [{ category: "PEN", value: 800 }], diagnostics: [] };
  }

  async closeProject(): Promise<void> {
    this.calls.closeProject += 1;
    this.#open = false;
  }

  openThenLoseReply(error: Error): Promise<OpenedProjection> {
    this.#opened();
    return Promise.reject(error);
  }

  close(): void {
    this.calls.close += 1;
    this.#open = false;
  }
}

function makeKit(client: FakeClient) {
  const projectTransferFromFiles = vi.fn(async (_files: FileList) => new ArrayBuffer(8));
  const projectTransferFromEntries = vi.fn((_files: readonly CanonicalProjectFile[]) => new ArrayBuffer(8));
  const preflightCanonicalProjectEntries = vi.fn(realPreflightCanonicalProjectEntries);
  const createExperimentalDesignerClient = vi.fn(() => client as never);
  const kit = {
    EXPERIMENTAL_CLIENT_KIT_ID: "tachiko-designer-client-kit/v0-experimental",
    createExperimentalDesignerClient,
    projectTransferFromFiles,
    projectTransferFromEntries,
    preflightCanonicalProjectEntries,
    DesignerRuntimeError: FakeDesignerRuntimeError,
  } as unknown as CoreKit;
  return { kit, createExperimentalDesignerClient, projectTransferFromFiles, projectTransferFromEntries, preflightCanonicalProjectEntries };
}

async function failure(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("expected the operation to reject");
    },
    (error: unknown) => error,
  );
}

function witnessOf(view: WorkbookView): ViewWitness {
  return { occurrence: view.occurrence, revision: view.revision };
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function opened(client = new FakeClient()) {
  const kitParts = makeKit(client);
  const runtime = createSheetRuntime(async () => kitParts.kit);
  const view = await runtime.openFiles(FILES);
  return { ...kitParts, client, runtime, view };
}

function installCatalog(
  client: FakeClient,
  definitions: Array<{
    collection: CollectionSummary;
    columns: Array<{ id: string; key: string; field_type: string }>;
    rows?: TableProjection["rows"];
  }>,
  revision = "r1",
): void {
  client.hooks.bootstrap = async () => {
    client.hooks.bootstrap = undefined;
    return {
      title: TITLE,
      revision,
      default_collection: definitions[0]!.collection.key,
      collections: definitions.map(({ collection }) => collection),
    };
  };
  let remainingTables = definitions.length;
  client.hooks.queryTable = async (key) => {
    const definition = definitions.find(({ collection }) => collection.key === key);
    if (!definition) throw new Error(`missing test table ${key}`);
    remainingTables -= 1;
    if (remainingTables === 0) client.hooks.queryTable = undefined;
    return {
      revision,
      collection: definition.collection,
      columns: definition.columns,
      rows: definition.rows ?? [],
    };
  };
}

function catalogTable(
  key: string,
  columns: Array<{ id: string; key: string; field_type: string }>,
  entityCount = 0,
): { collection: CollectionSummary; columns: typeof columns; rows: TableProjection["rows"] } {
  return {
    collection: { id: `schema-${key}`, key, entity_count: entityCount },
    columns,
    rows: [],
  };
}

describe("createSheetRuntime", () => {
  it("shares one read-only preparation and client with later explicit work", async () => {
    const client = new FakeClient();
    const kitParts = makeKit(client);
    const loadKit = vi.fn(async () => kitParts.kit);
    const runtime = createSheetRuntime(loadKit);

    await Promise.all([runtime.prepare(), runtime.prepare(), runtime.prepare()]);

    expect(loadKit).toHaveBeenCalledTimes(1);
    expect(kitParts.createExperimentalDesignerClient).toHaveBeenCalledTimes(1);
    expect(client.calls.observeOccurrence).toBe(1);
    expect(client.calls.openProject).toHaveLength(0);
    const view = await runtime.openFiles(FILES);
    expect(client.calls.observeOccurrence).toBe(2);
    expect(client.calls.openProject).toHaveLength(1);
    expect(view.occurrence).toBe("scope-1");
    expect(kitParts.createExperimentalDesignerClient).toHaveBeenCalledTimes(1);
  });

  it("shares a cached startup failure with prepare and a racing explicit Open", async () => {
    const client = new FakeClient();
    const kitParts = makeKit(client);
    const startupCause = new FakeDesignerRuntimeError("worker_start_failed", "resident/0");
    client.hooks.observeOccurrence = async () => { throw startupCause; };
    const runtime = createSheetRuntime(async () => kitParts.kit);

    const prepared = runtime.prepare();
    const open = runtime.openFiles(FILES);
    const prepareError = await failure(prepared);
    const openError = await failure(open);

    expect(prepareError).toBeInstanceOf(RuntimeStartupError);
    expect(openError).toBe(prepareError);
    expect(client.calls.observeOccurrence).toBe(1);
    expect(client.calls.openProject).toHaveLength(0);
    expect(kitParts.createExperimentalDesignerClient).toHaveBeenCalledTimes(1);
  });

  it("proves same-client startup readiness with one read-only observation before the first Open", async () => {
    const client = new FakeClient();
    const kitParts = makeKit(client);
    client.hooks.observeOccurrence = async () => {
      expect(client.calls.openProject).toHaveLength(0);
      throw new FakeDesignerRuntimeError("no_project_open", "resident/0");
    };
    const runtime = createSheetRuntime(async () => kitParts.kit);

    const view = await runtime.openFiles(FILES);

    expect(client.calls.observeOccurrence).toBe(2);
    expect(client.calls.openProject).toHaveLength(1);
    expect(kitParts.createExperimentalDesignerClient).toHaveBeenCalledTimes(1);
    expect(view.occurrence).toBe("scope-1");
  });

  it("caches a typed non-no-project startup failure and never dispatches Open", async () => {
    const client = new FakeClient();
    const kitParts = makeKit(client);
    const startupCause = new FakeDesignerRuntimeError("worker_start_failed", "resident/0");
    client.hooks.observeOccurrence = async () => { throw startupCause; };
    const runtime = createSheetRuntime(async () => kitParts.kit);

    const first = await failure(runtime.openFiles(FILES));
    const second = await failure(runtime.openCanonical(CANONICAL_FILES));

    expect(first).toBeInstanceOf(RuntimeStartupError);
    expect((first as RuntimeStartupError).cause).toBe(startupCause);
    expect(second).toBe(first);
    expect(client.calls.observeOccurrence).toBe(1);
    expect(client.calls.openProject).toHaveLength(0);
    expect(kitParts.createExperimentalDesignerClient).toHaveBeenCalledTimes(1);
  });

  it("rejects a malformed startup observation as typed pre-Open failure", async () => {
    const client = new FakeClient();
    const kitParts = makeKit(client);
    client.hooks.observeOccurrence = async () => ({ scope: "", revision: "resident/0" });
    const runtime = createSheetRuntime(async () => kitParts.kit);

    const error = await failure(runtime.openFiles(FILES));

    expect(error).toBeInstanceOf(RuntimeStartupError);
    expect((error as RuntimeStartupError).cause).toMatchObject({ message: expect.stringMatching(/valid occurrence projection/) });
    expect(client.calls.openProject).toHaveLength(0);
  });

  it("confirms scalar and tracker history publications against the coherent resident occurrence", async () => {
    const { client, runtime, view } = await opened();
    const edit = await runtime.editConfirmed(witnessOf(view), IMPACT, { kind: "number", input: "8" });
    expect(edit.publication.base_revision).toBe(view.revision);
    expect(edit.publication.resulting_revision).toBe(edit.view.revision);
    expect(edit.view.occurrence).toBe(view.occurrence);

    const undone = await runtime.trackerHistory(witnessOf(edit.view), "undo");
    expect(client.calls.trackerCommand).toEqual([{ type: "undo", expected_revision: edit.view.revision }]);
    expect(undone.publication.base_revision).toBe(edit.view.revision);
    expect(undone.view.occurrence).toBe(view.occurrence);
    const redone = await runtime.trackerHistory(witnessOf(undone.view), "redo");
    expect(redone.publication.base_revision).toBe(undone.view.revision);
    expect(client.calls.trackerCommand).toHaveLength(2);
  });

  it("rejects empty history and does not retry the dispatched command", async () => {
    const { client, runtime, view } = await opened();
    const refused = await failure(runtime.trackerHistory(witnessOf(view), "undo"));
    expect(refused).toBeInstanceOf(FakeDesignerRuntimeError);
    expect((refused as FakeDesignerRuntimeError).failure.code).toBe("no_history");
    expect(client.calls.trackerCommand).toHaveLength(1);
  });

  it("classifies a mismatched edit base as unknown before attempting a replacement read", async () => {
    const { client, runtime, view } = await opened();
    client.hooks.editNumber = async () => ({
      base_revision: "other-revision",
      resulting_revision: "r2",
      entities: [IMPACT.entity],
      fields: [IMPACT],
      affected_calculations: [],
    });
    client.hooks.queryTable = async () => { throw new Error("replacement read must not run"); };

    const error = await failure(runtime.editConfirmed(witnessOf(view), IMPACT, { kind: "number", input: "9" }));
    expect(error).toBeInstanceOf(UnknownOperationOutcomeError);
    expect((error as Error).cause).toMatchObject({ name: "SheetSessionError", code: "incoherent-reply" });
    expect(client.calls.editNumber).toBe(1);
    expect(client.calls.queryTable).toHaveLength(1);
    const refused = await failure(runtime.edit(witnessOf(view), IMPACT, { kind: "number", input: "10" }));
    expect((refused as SheetSessionError).code).toBe("not-open");
    expect(client.calls.editNumber).toBe(1);
  });

  it("classifies a mismatched history base as unknown before attempting a replacement read", async () => {
    const { client, runtime, view } = await opened();
    const edit = await runtime.editConfirmed(witnessOf(view), IMPACT, { kind: "number", input: "8" });
    client.hooks.trackerCommand = async () => ({
      base_revision: "other-revision",
      resulting_revision: "r3",
      entities: [IMPACT.entity],
      fields: [IMPACT],
      affected_calculations: [],
    });
    client.hooks.queryTable = async () => { throw new Error("replacement read must not run"); };

    const error = await failure(runtime.trackerHistory(witnessOf(edit.view), "undo"));
    expect(error).toBeInstanceOf(UnknownOperationOutcomeError);
    expect((error as Error).cause).toMatchObject({ name: "SheetSessionError", code: "incoherent-reply" });
    expect(client.calls.trackerCommand).toHaveLength(1);
    expect(client.calls.queryTable).toHaveLength(2);
  });

  it("classifies a valid-base history acknowledgement with an unreadable replacement as published recovery", async () => {
    const { client, runtime, view } = await opened();
    const edit = await runtime.editConfirmed(witnessOf(view), IMPACT, { kind: "number", input: "8" });
    client.hooks.queryTable = async () => { throw new Error("replacement read failed"); };

    const error = await failure(runtime.trackerHistory(witnessOf(edit.view), "undo"));
    expect(error).toHaveProperty("name", "PublishedProjectionRecoveryError");
    expect((error as { publication: PublicationProjection }).publication.base_revision).toBe(edit.view.revision);
    expect(client.calls.trackerCommand).toHaveLength(1);
    const refused = await failure(runtime.trackerHistory(witnessOf(edit.view), "undo"));
    expect((refused as SheetSessionError).code).toBe("not-open");
    expect(client.calls.trackerCommand).toHaveLength(1);
  });

  it("classifies a valid-base history receipt whose resulting revision disagrees with the read as published recovery", async () => {
    const { client, runtime, view } = await opened();
    const edit = await runtime.editConfirmed(witnessOf(view), IMPACT, { kind: "number", input: "8" });
    client.hooks.trackerCommand = async () => ({
      base_revision: edit.view.revision,
      resulting_revision: "unobserved-revision",
      entities: [IMPACT.entity],
      fields: [IMPACT],
      affected_calculations: [],
    });

    const error = await failure(runtime.trackerHistory(witnessOf(edit.view), "undo"));
    expect(error).toHaveProperty("name", "PublishedProjectionRecoveryError");
    expect(client.calls.trackerCommand).toHaveLength(1);
  });

  it("classifies a valid-base history receipt whose coherent read has another occurrence as published recovery", async () => {
    const { client, runtime, view } = await opened();
    const edit = await runtime.editConfirmed(witnessOf(view), IMPACT, { kind: "number", input: "8" });
    client.hooks.observeOccurrence = async () => ({ scope: "replacement-occurrence", revision: client.currentRevision });

    const error = await failure(runtime.trackerHistory(witnessOf(edit.view), "undo"));
    expect(error).toHaveProperty("name", "PublishedProjectionRecoveryError");
    expect(client.calls.trackerCommand).toHaveLength(1);
  });

  it("refuses stale history witnesses before dispatch and discards a reply after close without replay", async () => {
    const { client, runtime, view } = await opened();
    const edit = await runtime.editConfirmed(witnessOf(view), IMPACT, { kind: "number", input: "8" });
    const stale = await failure(runtime.trackerHistory({ occurrence: edit.view.occurrence, revision: "stale" }, "undo"));
    expect((stale as SheetSessionError).code).toBe("stale-witness");
    expect(client.calls.trackerCommand).toHaveLength(0);

    let resolveReply: ((publication: PublicationProjection) => void) | undefined;
    client.hooks.trackerCommand = () => new Promise((resolve) => { resolveReply = resolve; });
    const pending = runtime.trackerHistory(witnessOf(edit.view), "undo");
    while (!resolveReply) await Promise.resolve();
    const closing = runtime.close();
    resolveReply({
      base_revision: edit.view.revision,
      resulting_revision: "late-reply",
      entities: [IMPACT.entity],
      fields: [IMPACT],
      affected_calculations: [],
    });
    const late = await failure(pending);
    expect(late).toBeInstanceOf(SheetSessionError);
    expect(client.calls.trackerCommand).toHaveLength(1);
    await closing;
  });

  it("opens a FileList through the public transfer and keeps one resident client", async () => {
    const { client, runtime, view, projectTransferFromFiles, createExperimentalDesignerClient } =
      await opened();

    expect(projectTransferFromFiles).toHaveBeenCalledWith(FILES);
    expect(client.calls.openProject).toHaveLength(1);
    expect(view.occurrence).toBe("scope-1");
    expect(view.revision).toBe("r1");
    expect(view.title).toBe(TITLE);
    expect(view.collections).toEqual([COLLECTION]);
    expect(view.table.revision).toBe("r1");
    expect(client.calls.queryTable).toEqual([COLLECTION.key]);
    expect(createExperimentalDesignerClient).toHaveBeenCalledTimes(1);

    const refreshed = await runtime.read();
    expect(refreshed.occurrence).toBe("scope-1");
    expect(refreshed.revision).toBe("r1");
    expect(client.calls.observeOccurrence).toBe(3);
    expect(createExperimentalDesignerClient).toHaveBeenCalledTimes(1);

    await runtime.close();
    expect(client.calls.closeProject).toBe(1);
  });

  it("preflights saved canonical bytes, transfers them, then dispatches Open once", async () => {
    const client = new FakeClient();
    const kitParts = makeKit(client);
    const runtime = createSheetRuntime(async () => kitParts.kit);

    const view = await runtime.openCanonical(CANONICAL_FILES);

    expect(kitParts.preflightCanonicalProjectEntries).toHaveBeenCalledWith(CANONICAL_FILES);
    expect(kitParts.projectTransferFromEntries).toHaveBeenCalledWith(CANONICAL_FILES);
    expect(client.calls.openProject).toHaveLength(1);
    expect(kitParts.projectTransferFromFiles).not.toHaveBeenCalled();
    expect(view.occurrence).toBe("scope-1");
    expect(view.revision).toBe("r1");
  });

  it.each([
    ["duplicate", [{ path: "a", bytes: new ArrayBuffer(1) }, { path: "a", bytes: new ArrayBuffer(1) }]],
    ["unsafe", [{ path: "../escape", bytes: new ArrayBuffer(1) }]],
    ["oversize", [{ path: "a", bytes: new ArrayBuffer(64 * 1024 * 1024) }]],
  ] as const)("rejects %s canonical entries before Open and preserves resident work", async (_label, files) => {
    const { client, runtime, view, projectTransferFromEntries } = await opened();
    await expect(runtime.openCanonical(files)).rejects.toBeInstanceOf(Error);
    expect(projectTransferFromEntries).not.toHaveBeenCalled();
    expect(client.calls.openProject).toHaveLength(1);
    await expect(runtime.read()).resolves.toMatchObject({ occurrence: view.occurrence });
  });

  it("refuses a stale witness before dispatch", async () => {
    const { client, runtime, view } = await opened();

    const staleRevision = await failure(
      runtime.edit({ occurrence: view.occurrence, revision: "r0" }, IMPACT, {
        kind: "number",
        input: "3",
      }),
    );
    expect(staleRevision).toBeInstanceOf(SheetSessionError);
    expect((staleRevision as SheetSessionError).code).toBe("stale-witness");

    const staleOccurrence = await failure(
      runtime.edit({ occurrence: "scope-elsewhere", revision: view.revision }, IMPACT, {
        kind: "number",
        input: "3",
      }),
    );
    expect((staleOccurrence as SheetSessionError).code).toBe("stale-witness");

    const staleExport = await failure(
      runtime.exportCanonical({ occurrence: view.occurrence, revision: "r0" }),
    );
    expect((staleExport as SheetSessionError).code).toBe("stale-witness");

    expect(client.calls.editNumber).toBe(0);
    expect(client.calls.exportCanonicalTree).toHaveLength(0);
  });

  it("retains valid active work when an open is rejected, and still uses a fresh scope on success", async () => {
    const { client, runtime, view } = await opened();
    const rejection = new FakeDesignerRuntimeError("unsupported_project", "r1");
    client.hooks.openProject = async () => {
      throw rejection;
    };

    const refused = await failure(runtime.openFiles(FILES));
    expect(refused).toBe(rejection);
    expect(refused).not.toBeInstanceOf(UnknownOperationOutcomeError);

    const retained = await runtime.read();
    expect(retained.occurrence).toBe(view.occurrence);
    expect(retained.revision).toBe(view.revision);

    const edited = await runtime.edit(witnessOf(retained), IMPACT, { kind: "number", input: "3" });
    expect(client.calls.editNumber).toBe(1);
    expect(edited.revision).toBe("r2");

    const transport = new Error("The Designer Worker stopped unexpectedly.");
    client.hooks.openProject = async () => {
      throw transport;
    };
    const lost = await failure(runtime.openCanonical(CANONICAL_FILES));
    expect(lost).toBeInstanceOf(OpenedProjectionRecoveryError);
    expect((lost as OpenedProjectionRecoveryError).operationOutcome).toBe("unknown");
    expect(((lost as OpenedProjectionRecoveryError).cause as UnknownOperationOutcomeError).cause).toBe(transport);
    const stale = await failure(runtime.edit(witnessOf(edited), IMPACT, { kind: "number", input: "4" }));
    expect((stale as SheetSessionError).code).toBe("not-open");
    expect(client.calls.editNumber).toBe(1);
    expect((await runtime.read()).revision).toBe("r2");
  });

  it("gives a successful replacement a fresh occurrence scope", async () => {
    const { client, runtime, view } = await opened();
    const replacement = await runtime.openCanonical(CANONICAL_FILES);
    expect(replacement.occurrence).toBe("scope-2");
    expect(replacement.occurrence).not.toBe(view.occurrence);
    expect(client.calls.openProject).toHaveLength(2);
  });

  it("discards a late reply that arrives after close and cannot act on the next occurrence", async () => {
    const { client, runtime, view } = await opened();
    const pending = deferred<OccurrenceProjection>();
    client.hooks.observeOccurrence = () => pending.promise;

    const read = runtime.read();
    await tick();
    expect(client.calls.observeOccurrence).toBe(3);

    await runtime.close();
    expect(client.calls.closeProject).toBe(1);

    pending.resolve({ scope: view.occurrence, revision: view.revision });
    const late = await failure(read);
    expect(late).toBeInstanceOf(SheetSessionError);
    expect((late as SheetSessionError).code).toBe("closed");

    const closedRead = await failure(runtime.read());
    expect(closedRead).toBeInstanceOf(SheetSessionError);
    expect((closedRead as SheetSessionError).code).toBe("closed");

    const reopened = await runtime.openFiles(FILES);
    expect(reopened.occurrence).toBe("scope-2");
    const reread = await runtime.read();
    expect(reread.occurrence).toBe("scope-2");
    expect(reread.revision).toBe("r2");
  });

  it("refuses an open queued before close instead of repopulating a closed session", async () => {
    const { client, runtime } = await opened();

    const opening = runtime.openFiles(FILES);
    await runtime.close();

    const refused = await failure(opening);
    expect(refused).toBeInstanceOf(SheetSessionError);
    expect((refused as SheetSessionError).code).toBe("session-replaced");
    expect(client.calls.openProject).toHaveLength(1);

    const closedRead = await failure(runtime.read());
    expect((closedRead as SheetSessionError).code).toBe("closed");

    const reopened = await runtime.openFiles(FILES);
    expect(reopened.occurrence).toBe("scope-2");
    expect(reopened.revision).toBe("r2");
  });

  it("classifies a lost edit result as unknown and never replays the edit", async () => {
    const { client, runtime, view } = await opened();
    const transport = new Error("The Designer Worker stopped unexpectedly.");
    client.hooks.editText = async () => {
      throw transport;
    };

    const lost = await failure(
      runtime.edit(witnessOf(view), NOTES, { kind: "text", value: "先完成試玩回饋。" }),
    );
    expect(lost).toBeInstanceOf(UnknownOperationOutcomeError);
    expect((lost as UnknownOperationOutcomeError).cause).toBe(transport);
    expect(client.calls.editText).toBe(1);

    const duplicate = await failure(
      runtime.edit(witnessOf(view), NOTES, { kind: "text", value: "重試不得發送" }),
    );
    expect((duplicate as SheetSessionError).code).toBe("not-open");
    expect(client.calls.editText).toBe(1);

    const after = await runtime.read();
    expect(after.revision).toBe(view.revision);
  });

  it("invalidates a failed resident refresh and re-observes without replaying Open", async () => {
    const { client, runtime, view: first } = await opened();
    const oldWitness = witnessOf(first);
    const transport = new Error("resident query failed");
    client.hooks.queryTable = async () => {
      client.hooks.queryTable = undefined;
      throw transport;
    };

    const failed = await failure(runtime.openCanonical(CANONICAL_FILES));
    expect(failed).toBeInstanceOf(OpenedProjectionRecoveryError);
    expect((failed as OpenedProjectionRecoveryError).cause).toBeInstanceOf(UnknownOperationOutcomeError);
    expect(((failed as OpenedProjectionRecoveryError).cause as UnknownOperationOutcomeError).cause).toBe(transport);
    expect(client.calls.openProject).toHaveLength(2);

    const refused = await failure(runtime.edit(oldWitness, IMPACT, { kind: "number", input: "3" }));
    expect((refused as SheetSessionError).code).toBe("not-open");
    expect(client.calls.editNumber).toBe(0);

    const refreshed = await runtime.read();
    expect(refreshed.occurrence).toBe("scope-2");
    expect(refreshed.revision).toBe("r2");
    const stale = await failure(runtime.edit(oldWitness, IMPACT, { kind: "number", input: "4" }));
    expect((stale as SheetSessionError).code).toBe("stale-witness");
    expect(client.calls.editNumber).toBe(0);
    expect(client.calls.openProject).toHaveLength(2);
  });

  it("cannot edit a stale projection after refresh failure until re-observation succeeds", async () => {
    const { client, runtime, view } = await opened();
    const transport = new Error("refresh query failed");
    client.hooks.queryTable = async () => {
      client.hooks.queryTable = undefined;
      throw transport;
    };

    await failure(runtime.read());
    const refused = await failure(runtime.edit(witnessOf(view), IMPACT, { kind: "number", input: "9" }));
    expect((refused as SheetSessionError).code).toBe("not-open");
    expect(client.calls.editNumber).toBe(0);
    const refreshed = await runtime.read();
    expect(refreshed.revision).toBe(view.revision);
    expect(client.calls.editNumber).toBe(0);
  });

  it("re-observes after a closed session loses an open reply without opening twice", async () => {
    const { client, runtime } = await opened();
    await runtime.close();
    const transport = new Error("open reply lost");
    client.hooks.openProject = () => client.openThenLoseReply(transport);

    const failed = await failure(runtime.openFiles(FILES));
    expect(failed).toBeInstanceOf(OpenedProjectionRecoveryError);
    expect((failed as OpenedProjectionRecoveryError).operationOutcome).toBe("unknown");
    const reread = await runtime.read();
    expect(reread.occurrence).toBe("scope-2");
    expect(client.calls.openProject).toHaveLength(2);
  });

  it("leaves recovery when an unknown open installed no resident project", async () => {
    const { client, runtime } = await opened();
    await runtime.close();
    const transport = new Error("open transport failed before installation");
    client.hooks.openProject = async () => {
      throw transport;
    };

    const failedOpen = await failure(runtime.openFiles(FILES));
    expect(failedOpen).toBeInstanceOf(OpenedProjectionRecoveryError);
    expect(client.calls.openProject).toHaveLength(2);

    client.noProjectCode = "no_project_open";
    const observesBeforeRead = client.calls.observeOccurrence;
    const failedRead = await failure(runtime.read());
    expect(failedRead).toBeInstanceOf(NoResidentWorkError);
    expect(client.calls.observeOccurrence).toBe(observesBeforeRead + 1);
    const reopened = await runtime.openFiles(FILES);
    expect(reopened.occurrence).toBe("scope-2");
  });

  it("keeps a closed session closed when pre-dispatch transfer validation fails", async () => {
    const { client, runtime, projectTransferFromFiles } = await opened();
    await runtime.close();
    const validation = new Error("invalid project files");
    projectTransferFromFiles.mockRejectedValueOnce(validation);

    const failed = await failure(runtime.openFiles(FILES));
    expect(failed).toBe(validation);
    expect(failed).not.toBeInstanceOf(OpenedProjectionRecoveryError);
    expect(client.calls.openProject).toHaveLength(1);

    const closed = await failure(runtime.read());
    expect((closed as SheetSessionError).code).toBe("closed");
    const reopened = await runtime.openFiles(FILES);
    expect(reopened.occurrence).toBe("scope-2");
    expect(client.calls.openProject).toHaveLength(2);
  });

  it("retains publication truth while invalidating the old projection after reload failure", async () => {
    const { client, runtime, view } = await opened();
    const transport = new Error("reload query failed");
    let failures = 1;
    client.hooks.queryTable = async (collection) => {
      if (failures > 0) {
        failures -= 1;
        throw transport;
      }
      client.hooks.queryTable = undefined;
      return client.queryTable(collection);
    };

    const failed = await failure(runtime.edit(witnessOf(view), IMPACT, { kind: "number", input: "3" }));
    expect(failed).toHaveProperty("name", "PublishedProjectionRecoveryError");
    expect((failed as { publication: PublicationProjection }).publication.resulting_revision).toBe("r2");
    expect(client.calls.editNumber).toBe(1);

    const refused = await failure(runtime.edit(witnessOf(view), IMPACT, { kind: "number", input: "4" }));
    expect((refused as SheetSessionError).code).toBe("not-open");
    expect(client.calls.editNumber).toBe(1);

    const refreshed = await runtime.read();
    expect(refreshed.revision).toBe("r2");
    expect(client.calls.editNumber).toBe(1);
  });

  it("propagates a known core rejection unchanged", async () => {
    const { client, runtime, view } = await opened();
    const rejection = new FakeDesignerRuntimeError("invalid_value", "r1");
    client.hooks.editNumber = async () => {
      throw rejection;
    };

    const error = await failure(runtime.edit(witnessOf(view), IMPACT, { kind: "number", input: "no" }));
    expect(error).toBe(rejection);
    expect(error).not.toBeInstanceOf(UnknownOperationOutcomeError);
    expect(client.calls.editNumber).toBe(1);
    expect((await runtime.read()).revision).toBe(view.revision);
  });

  it("pins exportCanonical to the witness revision without implicit exports", async () => {
    const { client, runtime, view } = await opened();
    await runtime.read();
    expect(client.calls.exportCanonicalTree).toHaveLength(0);

    const tree = await runtime.exportCanonical(witnessOf(view));
    expect(client.calls.exportCanonicalTree).toEqual(["r1"]);
    expect(tree.revision).toBe("r1");
  });

  it("exports and reopens opaque core bytes only through the revision witness", async () => {
    const { client, runtime, view } = await opened();
    const exported = await runtime.exportOpaque(witnessOf(view));
    expect(client.calls.exportProject).toEqual(["r1"]);
    expect(Array.from(new Uint8Array(exported.bytes))).toEqual([7, 8, 9]);
    new Uint8Array(exported.bytes)[0] = 0;
    const reopened = await runtime.openOpaque(new Uint8Array([7, 8, 9]).buffer);
    expect(reopened.occurrence).toBe("scope-2");
    expect(client.calls.openProject).toHaveLength(2);
  });

  it("validates a retained imported-source attachment before reopening opaque bytes", async () => {
    const { client, runtime, view } = await opened();
    const bytes = new Uint8Array([7, 8, 9]).buffer;
    const metadata = { version: 1, sheets: [] };

    const reopened = await runtime.openOpaque(bytes, metadata);
    expect(reopened.occurrence).toBe("scope-2");
    expect(client.calls.inspectImportedProject).toHaveLength(1);
    expect(client.calls.inspectImportedProject[0].metadata).toBe(metadata);
    expect(client.calls.inspectImportedProject[0].bytes).not.toBe(bytes);
    expect(client.calls.openProject).toHaveLength(2);

    client.hooks.inspectImportedProject = async () => {
      throw new FakeDesignerRuntimeError("invalid_value", "r2");
    };
    const rejection = await failure(runtime.openOpaque(bytes, metadata));
    expect(rejection).toBeInstanceOf(FakeDesignerRuntimeError);
    expect(client.calls.openProject).toHaveLength(2);
    expect((await runtime.read()).revision).toBe(reopened.revision);
    expect(view.occurrence).toBe("scope-1");
  });

  it("resolves visible bindings to stable core IDs and clears the old witness after publication", async () => {
    const { client, runtime, view } = await opened();
    const result = await runtime.createKeyedGroupedSum(witnessOf(view), {
      ordersCollection: "tasks",
      orderLookupKeyField: "notes",
      orderQuantityField: "impact",
      productsCollection: "tasks",
      productKeyField: "notes",
      productCategoryField: "notes",
      productPriceField: "impact",
    });
    expect(result.groups).toEqual([{ category: "PEN", value: 800 }]);
    expect(result.revision).toBe("r2");
    expect(client.calls.createKeyedGroupedSum).toHaveLength(1);
    expect(client.calls.createKeyedGroupedSum[0]).toMatchObject({
      orders_schema: "col-1",
      order_lookup_key_field: "f2",
      order_quantity_field: "f1",
      products_schema: "col-1",
      product_key_field: "f2",
      product_category_field: "f2",
      product_price_field: "f1",
    });
    await expect(runtime.queryKeyedGroupedSum(witnessOf(view), result.definitionId)).rejects.toMatchObject({ code: "stale-witness" });
    const refreshed = await runtime.read();
    await expect(runtime.queryKeyedGroupedSum(witnessOf(refreshed), result.definitionId)).resolves.toMatchObject({ revision: "r2" });
  });

  it.each([
    {
      label: "selected table",
      definitions: [catalogTable("tasks", [
        { id: "f1", key: "impact", field_type: "number" },
        { id: "f2", key: "notes", field_type: "text" },
        { id: "f3", key: "when", field_type: "date" },
      ])],
    },
    {
      label: "unrelated third table",
      definitions: [
        catalogTable("tasks", [
          { id: "f1", key: "impact", field_type: "number" },
          { id: "f2", key: "notes", field_type: "text" },
        ]),
        catalogTable("inventory", [{ id: "f3", key: "received", field_type: "date" }]),
      ],
    },
    {
      label: "unrelated empty table schema",
      definitions: [
        catalogTable("tasks", [
          { id: "f1", key: "impact", field_type: "number" },
          { id: "f2", key: "notes", field_type: "text" },
        ]),
        catalogTable("inventory", [{ id: "f3", key: "received", field_type: "date" }]),
      ],
    },
  ])("refuses Date schemas in the $label before producer Create", async ({ definitions }) => {
    const { client, runtime, view } = await opened();
    const bootstrapBefore = client.calls.bootstrap;
    const queryTableBefore = client.calls.queryTable.length;
    installCatalog(client, definitions);
    const error = await failure(runtime.createKeyedGroupedSum(witnessOf(view), {
      ordersCollection: "tasks",
      orderLookupKeyField: "notes",
      orderQuantityField: "impact",
      productsCollection: "tasks",
      productKeyField: "notes",
      productCategoryField: "notes",
      productPriceField: "impact",
    }));
    expect((error as Error).message).toBe(DATE_SUMMARY_UNSUPPORTED_MESSAGE);
    expect(client.calls.bootstrap).toBe(bootstrapBefore + 1);
    expect(client.calls.queryTable.slice(queryTableBefore)).toEqual(definitions.map(({ collection }) => collection.key));
    expect(client.calls.createKeyedGroupedSum).toHaveLength(0);
    expect((await runtime.read()).revision).toBe(view.revision);
  });

  it("preserves reference as a non-Date type and still creates the requested summary", async () => {
    const { client, runtime, view } = await opened();
    const queryTableBefore = client.calls.queryTable.length;
    installCatalog(client, [catalogTable("tasks", [
      { id: "f1", key: "impact", field_type: "number" },
      { id: "f2", key: "notes", field_type: "reference" },
    ])]);
    await runtime.createKeyedGroupedSum(witnessOf(view), {
      ordersCollection: "tasks",
      orderLookupKeyField: "notes",
      orderQuantityField: "impact",
      productsCollection: "tasks",
      productKeyField: "notes",
      productCategoryField: "notes",
      productPriceField: "impact",
    });
    expect(client.calls.queryTable.slice(queryTableBefore, queryTableBefore + 1)).toEqual(["tasks"]);
    expect(client.calls.createKeyedGroupedSum).toHaveLength(1);
  });

  it.each([
    {
      label: "stale invocation witness",
      run: async (runtime: ReturnType<typeof createSheetRuntime>, view: WorkbookView) =>
        runtime.createKeyedGroupedSum({ ...witnessOf(view), revision: "stale" }, {
          ordersCollection: "tasks", orderLookupKeyField: "notes", orderQuantityField: "impact",
          productsCollection: "tasks", productKeyField: "notes", productCategoryField: "notes", productPriceField: "impact",
        }),
      install: (_client: FakeClient) => {},
      expectedCatalogCalls: 0,
      expectedTables: [],
    },
    {
      label: "stale bootstrap reply",
      run: async (runtime: ReturnType<typeof createSheetRuntime>, view: WorkbookView) =>
        runtime.createKeyedGroupedSum(witnessOf(view), {
          ordersCollection: "tasks", orderLookupKeyField: "notes", orderQuantityField: "impact",
          productsCollection: "tasks", productKeyField: "notes", productCategoryField: "notes", productPriceField: "impact",
        }),
      install: (client: FakeClient) => {
        client.hooks.bootstrap = async () => ({ title: TITLE, revision: "stale", default_collection: "tasks", collections: [COLLECTION] });
      },
      expectedCatalogCalls: 1,
      expectedTables: [],
    },
    {
      label: "stale table reply",
      run: async (runtime: ReturnType<typeof createSheetRuntime>, view: WorkbookView) =>
        runtime.createKeyedGroupedSum(witnessOf(view), {
          ordersCollection: "tasks", orderLookupKeyField: "notes", orderQuantityField: "impact",
          productsCollection: "tasks", productKeyField: "notes", productCategoryField: "notes", productPriceField: "impact",
        }),
      install: (client: FakeClient) => {
        client.hooks.queryTable = async () => ({
          revision: "stale", collection: COLLECTION,
          columns: [
            { id: "f1", key: "impact", field_type: "number" },
            { id: "f2", key: "notes", field_type: "text" },
          ],
          rows: [],
        });
      },
      expectedCatalogCalls: 1,
      expectedTables: ["tasks"],
    },
    {
      label: "unavailable unrelated table read",
      run: async (runtime: ReturnType<typeof createSheetRuntime>, view: WorkbookView) =>
        runtime.createKeyedGroupedSum(witnessOf(view), {
          ordersCollection: "tasks", orderLookupKeyField: "notes", orderQuantityField: "impact",
          productsCollection: "tasks", productKeyField: "notes", productCategoryField: "notes", productPriceField: "impact",
        }),
      install: (client: FakeClient) => {
        client.hooks.bootstrap = async () => ({ title: TITLE, revision: "r1", default_collection: "tasks", collections: [
          COLLECTION, { id: "col-2", key: "inventory", entity_count: 0 },
        ] });
        client.hooks.queryTable = async (key) => {
          if (key === "inventory") throw new Error("unavailable table");
          return { revision: "r1", collection: COLLECTION, columns: [
            { id: "f1", key: "impact", field_type: "number" },
            { id: "f2", key: "notes", field_type: "text" },
          ], rows: [] };
        };
      },
      expectedCatalogCalls: 1,
      expectedTables: ["tasks", "inventory"],
    },
  ])("fails closed on $label before producer Create", async ({ run, install, expectedCatalogCalls, expectedTables }) => {
    const { client, runtime, view } = await opened();
    const bootstrapBefore = client.calls.bootstrap;
    const queryTableBefore = client.calls.queryTable.length;
    install(client);
    const error = await failure(run(runtime, view));
    expect(error).toBeInstanceOf(Error);
    expect(client.calls.bootstrap).toBe(bootstrapBefore + expectedCatalogCalls);
    expect(client.calls.queryTable.slice(queryTableBefore)).toEqual(expectedTables);
    expect(client.calls.createKeyedGroupedSum).toHaveLength(0);
    expect(client.currentRevision).toBe(view.revision);
    client.hooks.bootstrap = undefined;
    client.hooks.queryTable = undefined;
    const reread = await runtime.read();
    expect(reread.occurrence).toBe(view.occurrence);
    expect(reread.revision).toBe(view.revision);
  });

  it("serializes operations so a stale second edit is refused before dispatch", async () => {
    const { client, runtime, view } = await opened();
    const [first, second] = await Promise.allSettled([
      runtime.edit(witnessOf(view), IMPACT, { kind: "number", input: "3" }),
      runtime.edit(witnessOf(view), NOTES, { kind: "text", value: "later" }),
    ]);

    expect(first.status).toBe("fulfilled");
    expect((first as PromiseFulfilledResult<WorkbookView>).value.revision).toBe("r2");
    expect(second.status).toBe("rejected");
    const reason = (second as PromiseRejectedResult).reason as SheetSessionError;
    expect(reason).toBeInstanceOf(SheetSessionError);
    expect(reason.code).toBe("stale-witness");
    expect(client.calls.editNumber).toBe(1);
    expect(client.calls.editText).toBe(0);
  });

  it("reads bounded fields under the witness revision and refuses after close", async () => {
    const { client, runtime, view } = await opened();
    const batch = await runtime.readFields(witnessOf(view), [IMPACT, NOTES]);
    expect(client.calls.queryFields).toEqual([{ revision: "r1", targets: [IMPACT, NOTES] }]);
    expect(batch.revision).toBe("r1");
    expect(batch.fields).toHaveLength(2);

    await runtime.close();
    await runtime.close();
    expect(client.calls.closeProject).toBe(1);
    const closedRead = await failure(runtime.read());
    expect((closedRead as SheetSessionError).code).toBe("closed");
  });
});
