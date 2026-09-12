/**
 * Focused unit evidence for the Sheet runtime adapter using a faithful
 * injected public-client fake. This is not acceptance or real-WASM proof.
 */
import { describe, expect, it, vi } from "vitest";
import type {
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
import {
  UnknownOperationOutcomeError,
  type CoreKit,
  type ViewWitness,
  type WorkbookView,
} from "../contracts.js";
import {
  OpenedProjectionRecoveryError,
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
  observeOccurrence?: () => Promise<OccurrenceProjection>;
  editNumber?: () => Promise<PublicationProjection>;
  editText?: () => Promise<PublicationProjection>;
  exportCanonicalTree?: (revision: string) => Promise<CanonicalTreeExport>;
  queryTable?: (collection: string) => Promise<TableProjection>;
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
    openCanonicalTree: [] as Array<readonly CanonicalProjectFile[]>,
    bootstrap: 0,
    observeOccurrence: 0,
    queryTable: [] as string[],
    queryFields: [] as Array<{ revision: string; targets: FieldTarget[] }>,
    editNumber: 0,
    editText: 0,
    editBoolean: 0,
    editDate: 0,
    exportCanonicalTree: [] as string[],
    closeProject: 0,
    close: 0,
  };

  hooks: Hooks = {};

  #open = false;
  #scope = 0;
  #counter = 0;
  #revision = "r0";

  #requireOpen(): void {
    if (!this.#open) throw new FakeDesignerRuntimeError("no_project", this.#revision);
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
    return {
      base_revision: base,
      resulting_revision: this.#revision,
      entities: [target.entity],
      fields: [target],
      affected_calculations: [],
    };
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

  async openCanonicalTree(files: readonly CanonicalProjectFile[]): Promise<OpenedProjection> {
    this.calls.openCanonicalTree.push(files);
    const hook = this.hooks.openProject;
    if (hook !== undefined) {
      this.hooks.openProject = undefined;
      return hook();
    }
    return this.#opened();
  }

  async bootstrap() {
    this.calls.bootstrap += 1;
    this.#requireOpen();
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

  async closeProject(): Promise<void> {
    this.calls.closeProject += 1;
    this.#open = false;
  }

  close(): void {
    this.calls.close += 1;
    this.#open = false;
  }
}

function makeKit(client: FakeClient) {
  const projectTransferFromFiles = vi.fn(async (_files: FileList) => new ArrayBuffer(8));
  const createExperimentalDesignerClient = vi.fn(() => client as never);
  const kit = {
    EXPERIMENTAL_CLIENT_KIT_ID: "tachiko-designer-client-kit/v0-experimental",
    createExperimentalDesignerClient,
    projectTransferFromFiles,
    DesignerRuntimeError: FakeDesignerRuntimeError,
  } as unknown as CoreKit;
  return { kit, createExperimentalDesignerClient, projectTransferFromFiles };
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

describe("createSheetRuntime", () => {
  it("opens a FileList through the public transfer and keeps one resident client", async () => {
    const { client, runtime, view, projectTransferFromFiles, createExperimentalDesignerClient } =
      await opened();

    expect(projectTransferFromFiles).toHaveBeenCalledWith(FILES);
    expect(client.calls.openProject).toHaveLength(1);
    expect(client.calls.openCanonicalTree).toHaveLength(0);
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
    expect(client.calls.observeOccurrence).toBe(2);
    expect(createExperimentalDesignerClient).toHaveBeenCalledTimes(1);

    await runtime.close();
    expect(client.calls.closeProject).toBe(1);
  });

  it("admits saved opaque canonical bytes through openCanonicalTree", async () => {
    const client = new FakeClient();
    const kitParts = makeKit(client);
    const runtime = createSheetRuntime(async () => kitParts.kit);

    const view = await runtime.openCanonical(CANONICAL_FILES);

    expect(client.calls.openCanonicalTree).toEqual([CANONICAL_FILES]);
    expect(client.calls.openProject).toHaveLength(0);
    expect(kitParts.projectTransferFromFiles).not.toHaveBeenCalled();
    expect(view.occurrence).toBe("scope-1");
    expect(view.revision).toBe("r1");
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
    expect(lost).toBeInstanceOf(UnknownOperationOutcomeError);
    expect((lost as UnknownOperationOutcomeError).cause).toBe(transport);
    expect((await runtime.read()).revision).toBe("r2");
  });

  it("gives a successful replacement a fresh occurrence scope", async () => {
    const { client, runtime, view } = await opened();
    const replacement = await runtime.openCanonical(CANONICAL_FILES);
    expect(replacement.occurrence).toBe("scope-2");
    expect(replacement.occurrence).not.toBe(view.occurrence);
    expect(client.calls.openProject).toHaveLength(1);
    expect(client.calls.openCanonicalTree).toHaveLength(1);
  });

  it("discards a late reply that arrives after close and cannot act on the next occurrence", async () => {
    const { client, runtime, view } = await opened();
    const pending = deferred<OccurrenceProjection>();
    client.hooks.observeOccurrence = () => pending.promise;

    const read = runtime.read();
    await tick();
    expect(client.calls.observeOccurrence).toBe(2);

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
    expect(client.calls.openCanonicalTree).toHaveLength(1);

    const refused = await failure(runtime.edit(oldWitness, IMPACT, { kind: "number", input: "3" }));
    expect((refused as SheetSessionError).code).toBe("not-open");
    expect(client.calls.editNumber).toBe(0);

    const refreshed = await runtime.read();
    expect(refreshed.occurrence).toBe("scope-2");
    expect(refreshed.revision).toBe("r2");
    const stale = await failure(runtime.edit(oldWitness, IMPACT, { kind: "number", input: "4" }));
    expect((stale as SheetSessionError).code).toBe("stale-witness");
    expect(client.calls.editNumber).toBe(0);
    expect(client.calls.openCanonicalTree).toHaveLength(1);
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
