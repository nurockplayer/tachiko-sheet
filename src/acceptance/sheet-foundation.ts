/**
 * Acceptance-only wiring for the Sheet M1 product slice.
 *
 * This module may observe real runtime/host/DOM state and may inject one
 * bounded fault into a real operation. It never publishes semantic state,
 * substitutes calculation results, approves anything or fabricates receipts.
 * It is imported only by the `acceptance` build (see `src/main.tsx`).
 */
import {
  UnknownOperationOutcomeError,
  type CoreKit,
  type KitLoader,
  type LocalCopies,
  type PresentationAttachment,
  type SheetRuntime,
  type WorkbookView,
} from "../contracts.js";
import { LOCAL_COPIES_DB_NAME, LOCAL_COPIES_STORE } from "../host/local-copies.js";
import type { FieldProjection, PublicationProjection } from "../../public/core-kit/experimental-client.js";
import { hashCanonicalFiles } from "./canonical-hash.js";
import { applyResolvedProfile, resolveInterfaceProfile } from "../ui/interface-profile/index.js";

export interface AcceptanceRuntimeSnapshot {
  occurrence: string;
  revision: string;
  opaqueBytesHash: string;
}

export interface AcceptanceSavedSnapshot {
  kind: "canonical" | "opaque";
  revision: string;
  bytesHash: string;
  presentation: PresentationAttachment | null;
}

export interface AcceptanceObservation {
  occurrence: string;
  revision: string;
  entity: string;
  impact: number | null;
  priority: number | null;
  notes: string | null;
  canonicalHash: string;
}

export interface AcceptanceSaveObservation {
  saveStatus: string | null;
  saved: boolean;
  dirty: boolean;
  currentness: string | null;
}

export interface AcceptanceUnknownObservation {
  outcome: string;
  saved: boolean;
  staleValuesPresentedAsCurrent: boolean;
  currentness: string | null;
}

export interface ScalarRequeryFaultProbe {
  attemptId: number | null;
  publicationAcknowledged: boolean;
  clientIdentity: number | null;
  occurrence: string | null;
  publicationCallId: number | null;
  revision: string | null;
  discoveryInvocationId: number | null;
  suppliedWitness: { occurrence: string; revision: string } | null;
  queryCallIds: number[];
  invokedDefinitionIds: string[];
  discardedDefinitionId: string | null;
  secondReplyHeld: boolean;
  invalidReason: "ambiguous-runtime-invocation" | null;
}

export interface TargetedQueryFaultProbe {
  armed: boolean;
  definitionId: string | null;
  occurrence: string | null;
  revision: string | null;
  owningClientIdentity: number | null;
  actualReplyRevision: string | null;
  receivedDefinitionId: string | null;
  receivedOccurrence: string | null;
  receivedRevision: string | null;
  consumed: boolean;
  resetReason: string | null;
}

export interface AcceptanceCoreFailureProbe {
  name: string;
  causeName: string;
  causeFailureCode: string | null;
}

export interface AcceptanceApi {
  runtimeSnapshot(): Promise<AcceptanceRuntimeSnapshot>;
  savedSnapshot(name: string): Promise<AcceptanceSavedSnapshot | null>;
  workMethodCounts(): Record<string, number>;
  applyInterfaceProfile(input: unknown): boolean;
  observe(): Promise<AcceptanceObservation>;
  savedHash(name: string): Promise<string | null>;
  failNextSave(): void;
  failNextSpreadsheetExport(): void;
  failNextCleanupPreview(): void;
  deferNextImportInspection(): void;
  releaseImportInspection(): void;
  deferNextImportApplication(): void;
  releaseImportApplication(): void;
  deferNextCopyWrite(): void;
  releaseCopyWrite(): void;
  loseNextExecuteReply(): void;
  loseNextOpenReply(): void;
  loseNextImportBeforeDispatch(): void;
  loseNextImportReplyAfterDispatch(): void;
  failNextImportProjection(): void;
  failNextOpenProjection(): void;
  failNextJ4PostPublicationRead(): void;
  failSecondScalarRequeryReplyAfterFirst(): void;
  deferSecondScalarRequeryReply(): void;
  releaseSecondScalarRequeryReply(): void;
  resetScalarRequeryFaultProbe(): void;
  scalarRequeryFaultProbe(): ScalarRequeryFaultProbe;
  armTargetedQueryReplyFault(definitionId: string, occurrence: string, revision: string): void;
  resetTargetedQueryReplyFault(): void;
  targetedQueryFaultProbe(): TargetedQueryFaultProbe;
  queryDefinitionIds(): string[];
  resetQueryDefinitionIds(): void;
  openProjectRequestCount(): number;
  importSpreadsheetRequestCount(): number;
  executeRequestCount(): number;
  settleFaultWindow(): Promise<void>;
  saveObservation(): AcceptanceSaveObservation;
  unknownObservation(): AcceptanceUnknownObservation;
  lastReceipt(): PublicationProjection | null;
  exportDispatchCounts(): { canonical: number; opaque: number };
  copyWriteDispatchCounts(): { canonical: number; opaque: number };
  acceptanceHarnessVersion(): string;
  resetCoreFailureProbe(): void;
  coreFailureProbe(): AcceptanceCoreFailureProbe | null;
}

export interface AcceptanceWiring {
  runtime: SheetRuntime;
  copies: LocalCopies;
  kitLoader: KitLoader;
}

declare global {
  interface Window {
    __tachikoAcceptance?: AcceptanceApi;
  }
}

type PublicClient = ReturnType<CoreKit["createExperimentalDesignerClient"]>;

const EDIT_METHODS = new Set(["editNumber", "editText", "editBoolean", "editDate"]);
const PUBLICATION_METHODS = new Set([...EDIT_METHODS, "commitCleanup"]);
const OBSERVED_COLUMN_KEYS = ["impact", "priority", "notes"] as const;
const ACCEPTANCE_HARNESS_VERSION = "j4-scalar-edit-requery-fault-v2";

let wiring: AcceptanceWiring | null = null;
const workMethodInvocations = new Map<string, number>();
let dispatchCount = 0;
let loseArmed = false;
let openReplyFaultArmed = false;
let importBeforeDispatchFaultArmed = false;
let importReplyAfterDispatchFaultArmed = false;
let importProjectionFaultRequested = false;
let importProjectionFaultArmed = false;
let openProjectionFaultArmed = false;
let j4PostPublicationReadFaultRequested = false;
let j4PostPublicationReadFaultArmed = false;
let j4PostPublicationReadSkipped = false;
let scalarRequeryFaultProbeValue: ScalarRequeryFaultProbe = {
  attemptId: null,
  publicationAcknowledged: false,
  clientIdentity: null,
  occurrence: null,
  publicationCallId: null,
  revision: null,
  discoveryInvocationId: null,
  suppliedWitness: null,
  queryCallIds: [],
  invokedDefinitionIds: [],
  discardedDefinitionId: null,
  secondReplyHeld: false,
  invalidReason: null,
};
let openProjectDispatchCount = 0;
let importSpreadsheetDispatchCount = 0;
let exportCanonicalDispatchCount = 0;
let exportOpaqueDispatchCount = 0;
let copyCanonicalDispatchCount = 0;
let copyOpaqueDispatchCount = 0;
let lastReceiptValue: PublicationProjection | null = null;
let settlePendingFault: (() => void) | null = null;
let pendingFault: Promise<void> | null = null;
let lastCoreFailureProbe: AcceptanceCoreFailureProbe | null = null;
let spreadsheetExportFaultArmed = false;
let cleanupPreviewFaultArmed = false;

function operationGate() {
  let armed = false;
  let active = false;
  let pending: Promise<void> | null = null;
  let releasePending: (() => void) | null = null;
  let generation = 0;
  return {
    defer(): void {
      if (armed || active) return;
      armed = true;
      pending = new Promise<void>((resolve) => { releasePending = resolve; });
    },
    async pause(): Promise<void> {
      if (!armed || !pending) return;
      const pauseGeneration = generation;
      armed = false;
      active = true;
      const wait = pending;
      pending = null;
      await wait;
      if (pauseGeneration === generation) active = false;
    },
    release(): void {
      const resolve = releasePending;
      releasePending = null;
      resolve?.();
    },
    reset(): void {
      generation += 1;
      const resolve = releasePending;
      releasePending = null;
      armed = false;
      active = false;
      pending = null;
      resolve?.();
    },
    isActive(): boolean {
      return active;
    },
  };
}

const importInspectionGate = operationGate();
const importApplicationGate = operationGate();
const copyWriteGate = operationGate();
const scalarRequerySecondReplyGate = operationGate();
interface ScalarAttempt {
  readonly id: number;
  phase: "requested" | "publication-dispatched" | "published" | "acknowledged" | "discovering" | "consumed" | "retired";
  editInvocationId: number | null;
  requestWitness: { occurrence: string; revision: string } | null;
  clientIdentity: number | null;
  publicationCallId: number | null;
  revision: string | null;
  resultWitness: { occurrence: string; revision: string } | null;
  discoveryInvocationId: number | null;
  suppliedWitness: { occurrence: string; revision: string } | null;
  invokedDefinitionIds: string[];
  queryCallIds: number[];
  discardedDefinitionId: string | null;
  holdRequested: boolean;
  runtimeState: RuntimeInvocationState | null;
  cancellationGenerationAtRequest: number | null;
}
interface ScalarDiscoveryContext {
  readonly attempt: ScalarAttempt;
  readonly invocationId: number;
  readonly witness: { occurrence: string; revision: string };
  readonly runtimeInvocationId: number;
  valid: boolean;
  bootstrapConfirmed: boolean;
  definitionIds: string[];
  nextDefinitionIndex: number;
}
type RuntimeSeam = "publication" | "bootstrap" | "grouped-query" | "observation" | "close-project";
interface RuntimeInvocationState {
  readonly runtime: object;
  readonly active: Set<RuntimeInvocation>;
  clientIdentity: number | null;
  cancellationGeneration: number;
  associationConflict: boolean;
}
interface RuntimeInvocation {
  readonly id: number;
  readonly state: RuntimeInvocationState;
  readonly method: string;
  readonly seams: ReadonlySet<RuntimeSeam>;
  readonly attemptAtEntry: ScalarAttempt | null;
  readonly cancellationGenerationAtEntry: number;
  ambiguous: boolean;
  scalarDiscovery: ScalarDiscoveryContext | null;
}
interface RuntimeOriginResolution {
  readonly status: "valid" | "independent" | "ambiguous-stale-unbound";
  readonly invocation: RuntimeInvocation | null;
  readonly state: RuntimeInvocationState | null;
}
const RUNTIME_METHOD_SEAMS: Record<string, readonly RuntimeSeam[]> = {
  openFiles: ["publication", "observation", "bootstrap"],
  openCanonical: ["publication", "observation", "bootstrap"],
  openOpaque: ["publication", "observation", "bootstrap"],
  read: ["observation", "bootstrap"],
  selectCollection: ["observation", "bootstrap"],
  edit: ["publication", "observation", "bootstrap"],
  listKeyedGroupedSumBindings: ["bootstrap"],
  queryKeyedGroupedSum: ["grouped-query"],
  discoverKeyedGroupedSums: ["bootstrap", "grouped-query"],
  createKeyedGroupedSum: ["publication", "observation", "bootstrap"],
  importSpreadsheet: ["publication", "observation", "bootstrap"],
  commitCleanup: ["publication", "observation", "bootstrap"],
  close: ["close-project"],
};
let runtimeInvocationSequence = 0;
const runtimeInvocationStates = new WeakMap<object, RuntimeInvocationState>();
const activeRuntimeInvocationStates = new Set<RuntimeInvocationState>();
const runtimeInvocationStack: RuntimeInvocation[] = [];
const wrappedKitLoaders = new WeakSet<KitLoader>();
const loaderRuntimeBindings = new WeakMap<KitLoader, RuntimeInvocationState>();
let scalarAttemptSequence = 0;
let scalarOperationSequence = 0;
let latestPublicationOperationId = 0;
let currentScalarAttempt: ScalarAttempt | null = null;
const queryDefinitionIdLog: string[] = [];
interface AcceptanceClientEvidence {
  identity: number;
  occurrence: string | null;
  revision: string | null;
  runtimeState: RuntimeInvocationState | null;
  association: "mapped" | "independent" | "ambiguous";
}
interface ObservedDefinitionQuery {
  definitionId: string;
  occurrence: string | null;
  revision: string | null;
  clientIdentity: number;
}
interface TargetedQueryRequest {
  generation: number;
  definitionId: string;
  occurrence: string;
  revision: string;
  clientIdentity: number;
}
let acceptanceClientIdentity = 0;
const clientEvidence = new WeakMap<object, AcceptanceClientEvidence>();
const clientEvidenceByIdentity = new Map<number, AcceptanceClientEvidence>();
let acceptanceObservationSequence = 0;
const latestObservationByClient = new WeakMap<object, number>();
const observedDefinitionQueries: ObservedDefinitionQuery[] = [];
let targetedQueryFaultGeneration = 0;
let targetedQueryFaultArmed = false;
let targetedQueryRequest: TargetedQueryRequest | null = null;
let targetedQueryFaultProbeValue: TargetedQueryFaultProbe = {
  armed: false,
  definitionId: null,
  occurrence: null,
  revision: null,
  owningClientIdentity: null,
  actualReplyRevision: null,
  receivedDefinitionId: null,
  receivedOccurrence: null,
  receivedRevision: null,
  consumed: false,
  resetReason: null,
};

function scalarAttemptIsCurrent(attempt: ScalarAttempt): boolean {
  return currentScalarAttempt === attempt && attempt.phase !== "retired" && attempt.runtimeState !== null &&
    attempt.cancellationGenerationAtRequest === attempt.runtimeState.cancellationGeneration;
}

function runtimeStateFor(runtime: object): RuntimeInvocationState {
  const existing = runtimeInvocationStates.get(runtime);
  if (existing) return existing;
  const state: RuntimeInvocationState = {
    runtime,
    active: new Set(),
    clientIdentity: null,
    cancellationGeneration: 0,
    associationConflict: false,
  };
  runtimeInvocationStates.set(runtime, state);
  return state;
}

function currentRuntimeInvocation(runtime: object): RuntimeInvocation | null {
  const top = runtimeInvocationStack[runtimeInvocationStack.length - 1];
  return top?.state.runtime === runtime ? top : null;
}

function seamsIntersect(left: ReadonlySet<RuntimeSeam>, right: ReadonlySet<RuntimeSeam>): boolean {
  for (const seam of left) if (right.has(seam)) return true;
  return false;
}

function runtimeInvocationOrigin(clientIdentity: number, seam: RuntimeSeam): RuntimeOriginResolution {
  const evidence = clientEvidenceByIdentity.get(clientIdentity);
  const state = evidence?.runtimeState ?? null;
  if (!evidence) return { status: "ambiguous-stale-unbound", invocation: null, state };
  if (evidence.association === "independent") {
    return { status: "independent", invocation: null, state: null };
  }
  if (!evidence || evidence.association === "ambiguous" || !state || state.associationConflict) {
    return { status: "ambiguous-stale-unbound", invocation: null, state };
  }

  const candidates = [...state.active].filter((invocation) => invocation.seams.has(seam));
  const valid = candidates.filter((invocation) =>
    !invocation.ambiguous && invocation.cancellationGenerationAtEntry === state.cancellationGeneration,
  );
  if (candidates.length !== 1 || valid.length !== 1) {
    for (const candidate of candidates) candidate.ambiguous = true;
    const attempt = currentScalarAttempt;
    if (attempt?.runtimeState === state && candidates.some((candidate) => candidate.attemptAtEntry === attempt)) {
      retireScalarAttempt(attempt, "ambiguous-runtime-invocation");
    }
    return { status: "ambiguous-stale-unbound", invocation: null, state };
  }
  return { status: "valid", invocation: valid[0], state };
}

function beginRuntimeInvocation(state: RuntimeInvocationState, method: string, args: unknown[]): RuntimeInvocation {
  if (method === "close") {
    state.cancellationGeneration += 1;
    if (currentScalarAttempt?.runtimeState === state) retireScalarAttempt(currentScalarAttempt);
  }
  const seams = new Set<RuntimeSeam>(RUNTIME_METHOD_SEAMS[method] ?? []);
  const conflicts = [...state.active].filter((active) => seamsIntersect(active.seams, seams));
  const relatedAttempt = currentScalarAttempt?.runtimeState === state &&
    currentScalarAttempt.cancellationGenerationAtRequest === state.cancellationGeneration
    ? currentScalarAttempt
    : null;
  const overlapping = conflicts.length > 0;
  const attemptAtEntry = !overlapping ? relatedAttempt : null;
  const invocation: RuntimeInvocation = {
    id: ++runtimeInvocationSequence,
    state,
    method,
    seams,
    attemptAtEntry,
    cancellationGenerationAtEntry: state.cancellationGeneration,
    ambiguous: overlapping,
    scalarDiscovery: null,
  };
  state.active.add(invocation);
  activeRuntimeInvocationStates.add(state);
  if (method === "close") {
    for (const active of state.active) {
      if (active !== invocation) active.ambiguous = true;
    }
  }
  if (overlapping) {
    for (const conflict of conflicts) conflict.ambiguous = true;
    if (relatedAttempt) retireScalarAttempt(relatedAttempt, "ambiguous-runtime-invocation");
  } else if (attemptAtEntry && method !== "edit" && seams.has("publication")) {
    retireScalarAttempt(attemptAtEntry);
  } else if (attemptAtEntry && method === "edit") {
    const witness = args[0] as { occurrence?: unknown; revision?: unknown } | undefined;
    if (attemptAtEntry.phase === "requested" && attemptAtEntry.editInvocationId === null &&
      typeof witness?.occurrence === "string" && typeof witness.revision === "string") {
      attemptAtEntry.runtimeState = state;
      attemptAtEntry.editInvocationId = invocation.id;
      attemptAtEntry.requestWitness = { occurrence: witness.occurrence, revision: witness.revision };
    } else {
      retireScalarAttempt(attemptAtEntry);
    }
  }
  return invocation;
}

function finishRuntimeInvocation(invocation: RuntimeInvocation): void {
  invocation.state.active.delete(invocation);
  if (invocation.state.active.size === 0) activeRuntimeInvocationStates.delete(invocation.state);
}

function installRuntimeInvocationTracking(runtime: object): void {
  const state = runtimeStateFor(runtime);
  const target = runtime as Record<string, unknown>;
  for (const method of Object.keys(target)) {
    const original = target[method];
    if (typeof original !== "function") continue;
    target[method] = function trackedRuntimeOperation(this: unknown, ...args: unknown[]): unknown {
      const invocation = beginRuntimeInvocation(state, method, args);
      runtimeInvocationStack.push(invocation);
      let result: unknown;
      try {
        result = original.apply(this, args);
      } catch (error) {
        finishRuntimeInvocation(invocation);
        throw error;
      } finally {
        runtimeInvocationStack.pop();
      }
      return Promise.resolve(result).finally(() => finishRuntimeInvocation(invocation));
    };
  }
}

function updateScalarProbe(attempt: ScalarAttempt): void {
  if (!scalarAttemptIsCurrent(attempt)) return;
  scalarRequeryFaultProbeValue = {
    attemptId: attempt.id,
    publicationAcknowledged: attempt.phase === "acknowledged" || attempt.phase === "discovering" || attempt.phase === "consumed",
    clientIdentity: attempt.clientIdentity,
    occurrence: attempt.resultWitness?.occurrence ?? attempt.requestWitness?.occurrence ?? null,
    publicationCallId: attempt.publicationCallId,
    revision: attempt.revision,
    discoveryInvocationId: attempt.discoveryInvocationId,
    suppliedWitness: attempt.suppliedWitness ? { ...attempt.suppliedWitness } : null,
    queryCallIds: [...attempt.queryCallIds],
    invokedDefinitionIds: [...attempt.invokedDefinitionIds],
    discardedDefinitionId: attempt.discardedDefinitionId,
    secondReplyHeld: scalarRequerySecondReplyGate.isActive(),
    invalidReason: null,
  };
}

function retireScalarAttempt(
  attempt: ScalarAttempt | null = currentScalarAttempt,
  invalidReason: ScalarRequeryFaultProbe["invalidReason"] = null,
): void {
  if (!attempt || currentScalarAttempt !== attempt) return;
  attempt.phase = "retired";
  currentScalarAttempt = null;
  for (const state of activeRuntimeInvocationStates) {
    for (const invocation of state.active) {
      if (invocation.scalarDiscovery?.attempt === attempt) invocation.scalarDiscovery.valid = false;
    }
  }
  scalarRequerySecondReplyGate.reset();
  scalarRequeryFaultProbeValue = {
    attemptId: null,
    publicationAcknowledged: false,
    clientIdentity: null,
    occurrence: null,
    publicationCallId: null,
    revision: null,
    discoveryInvocationId: null,
    suppliedWitness: null,
    queryCallIds: [],
    invokedDefinitionIds: [],
    discardedDefinitionId: null,
    secondReplyHeld: false,
    invalidReason,
  };
}

function requestScalarAttempt(): ScalarAttempt {
  retireScalarAttempt();
  const state = wiring ? runtimeStateFor(wiring.runtime) : null;
  if (state) state.cancellationGeneration += 1;
  const attempt: ScalarAttempt = {
    id: ++scalarAttemptSequence,
    phase: "requested",
    editInvocationId: null,
    requestWitness: null,
    clientIdentity: null,
    publicationCallId: null,
    revision: null,
    resultWitness: null,
    discoveryInvocationId: null,
    suppliedWitness: null,
    queryCallIds: [],
    invokedDefinitionIds: [],
    discardedDefinitionId: null,
    holdRequested: false,
    runtimeState: state,
    cancellationGenerationAtRequest: state?.cancellationGeneration ?? null,
  };
  currentScalarAttempt = attempt;
  updateScalarProbe(attempt);
  return attempt;
}

function requireWiring(): AcceptanceWiring {
  if (!wiring) throw new Error("The acceptance wiring has not been installed.");
  return wiring;
}

/**
 * Wraps the real kit loader so the acceptance build observes the actual public
 * client instance dispatched by the product, via a Proxy with bound methods.
 */
export function wrapKitLoader(load: KitLoader): KitLoader {
  const wrapped: KitLoader = async (): Promise<CoreKit> => {
    const owner = loaderRuntimeBindings.get(wrapped) ?? null;
    return instrumentKit(await load(), owner);
  };
  wrappedKitLoaders.add(wrapped);
  return wrapped;
}

function instrumentKit(kit: CoreKit, owner: RuntimeInvocationState | null): CoreKit {
  const create = kit.createExperimentalDesignerClient;
  return {
    ...kit,
    createExperimentalDesignerClient: () => observeClientMethods(instrumentClient(create(), owner)),
  };
}

/** Count public client invocations without changing the existing fault wrappers. */
function observeClientMethods(client: PublicClient): PublicClient {
  return new Proxy(client, {
    get(target, property): unknown {
      const value = Reflect.get(target, property, target) as unknown;
      if (typeof value !== "function") return value;
      return (...args: unknown[]): unknown => {
        if (typeof property === "string") {
          workMethodInvocations.set(property, (workMethodInvocations.get(property) ?? 0) + 1);
        }
        return Reflect.apply(value, target, args);
      };
    },
  });
}

/**
 * Attribution relies on the runtime's cached public client remaining private
 * to its loader/runtime composition. Acceptance code never dispatches through
 * that mapped client directly; external direct calls to it cannot be
 * distinguished from a sole live runtime origin and receive no evidence
 * credit unless the retained runtime invocation proves the dispatch.
 */
function instrumentClient(client: PublicClient, runtimeState: RuntimeInvocationState | null): PublicClient {
  const evidence: AcceptanceClientEvidence = {
    identity: ++acceptanceClientIdentity,
    occurrence: null,
    revision: null,
    runtimeState,
    association: runtimeState ? "mapped" : "independent",
  };
  if (runtimeState) {
    if (runtimeState.clientIdentity === null) runtimeState.clientIdentity = evidence.identity;
    else if (runtimeState.clientIdentity !== evidence.identity) runtimeState.associationConflict = true;
  }
  clientEvidence.set(client, evidence);
  clientEvidenceByIdentity.set(evidence.identity, evidence);
  return new Proxy(client, {
    get(target, property): unknown {
      const value = Reflect.get(target, property, target) as unknown;
      if (typeof value !== "function") return value;
      if (typeof property === "string" && PUBLICATION_METHODS.has(property)) {
        return (...args: unknown[]): Promise<PublicationProjection> =>
          dispatchPublication(target, property, args);
      }
      if (property === "queryTable") {
        return async (...args: unknown[]): Promise<unknown> => {
          const result = await (value as (...args: unknown[]) => Promise<unknown>).apply(target, args);
          if (openProjectionFaultArmed) {
            openProjectionFaultArmed = false;
            throw new Error("The replacement projection reply was lost after real open dispatch.");
          }
          if (importProjectionFaultArmed) {
            importProjectionFaultArmed = false;
            throw new Error("The replacement projection reply was lost after real import dispatch.");
          }
          // A J4 create first re-observes its acknowledged publication inside
          // the runtime. The App's following read is deliberately faulted to
          // exercise its published-recovery boundary without faking a receipt.
          if (j4PostPublicationReadFaultArmed) {
            if (!j4PostPublicationReadSkipped) {
              j4PostPublicationReadSkipped = true;
            } else {
              j4PostPublicationReadFaultArmed = false;
              j4PostPublicationReadSkipped = false;
              throw new Error("The post-publication J4 read projection reply was lost.");
            }
          }
          return result;
        };
      }
      if (property === "queryKeyedGroupedSum") {
        return async (...args: unknown[]): Promise<unknown> => {
          const definitionId = String(args[0]);
          const originAtDispatch = runtimeInvocationOrigin(evidence.identity, "grouped-query");
          const originInvocationAtDispatch = originAtDispatch.invocation;
          const scalarContextAtDispatch = originInvocationAtDispatch?.method === "discoverKeyedGroupedSums"
            ? originInvocationAtDispatch.scalarDiscovery
            : null;
          const scalarAttemptAtDispatch = scalarContextAtDispatch?.attempt ?? null;
          const scalarAttemptPointerAtDispatch = currentScalarAttempt;
          const generationAtDispatch = evidence.runtimeState?.cancellationGeneration ?? null;
          const scalarQueryCallId = ++scalarOperationSequence;
          let scalarQueryExpected = false;
          if (scalarContextAtDispatch && scalarAttemptAtDispatch && scalarContextAtDispatch.valid &&
            scalarAttemptIsCurrent(scalarAttemptAtDispatch)) {
            if (scalarContextAtDispatch.bootstrapConfirmed &&
              scalarContextAtDispatch.definitionIds[scalarContextAtDispatch.nextDefinitionIndex] === definitionId) {
              scalarQueryExpected = true;
              scalarContextAtDispatch.nextDefinitionIndex += 1;
            } else {
              scalarContextAtDispatch.valid = false;
              retireScalarAttempt(scalarAttemptAtDispatch);
            }
          }
          const targetedGenerationAtDispatch = targetedQueryFaultGeneration;
          const targetedRequestAtDispatch = targetedQueryRequest;
          const targetedWasArmedAtDispatch = targetedQueryFaultArmed;
          queryDefinitionIdLog.push(definitionId);
          let result: unknown;
          try {
            result = await (value as (...args: unknown[]) => Promise<unknown>).apply(target, args);
          } catch (error) {
            if (scalarContextAtDispatch && scalarAttemptAtDispatch &&
              scalarContextAtDispatch.valid && scalarAttemptIsCurrent(scalarAttemptAtDispatch) &&
              scalarAttemptAtDispatch.discoveryInvocationId === scalarContextAtDispatch.invocationId &&
              scalarQueryCallId > 0) {
              retireScalarAttempt(scalarAttemptAtDispatch);
            }
            if (targetedWasArmedAtDispatch && targetedQueryFaultArmed &&
              targetedQueryFaultGeneration === targetedGenerationAtDispatch &&
              targetedQueryRequest === targetedRequestAtDispatch) {
              clearTargetedQueryReplyFault("real-query-failed");
            }
            throw error;
          }
          const actualRevision = (result as { revision?: unknown }).revision;
          const scalarQueryStillOwned = Boolean(scalarContextAtDispatch && scalarQueryExpected && scalarAttemptAtDispatch &&
            scalarContextAtDispatch.valid && currentScalarAttempt === scalarAttemptAtDispatch &&
            scalarAttemptAtDispatch.phase === "discovering" &&
            scalarAttemptAtDispatch.discoveryInvocationId === scalarContextAtDispatch.invocationId &&
            scalarAttemptAtDispatch.clientIdentity === evidence.identity &&
            originAtDispatch.status === "valid" && originInvocationAtDispatch?.id === scalarContextAtDispatch.runtimeInvocationId &&
            scalarAttemptAtDispatch.runtimeState === evidence.runtimeState &&
            scalarAttemptAtDispatch.cancellationGenerationAtRequest === generationAtDispatch &&
            scalarContextAtDispatch.witness.occurrence === scalarAttemptAtDispatch.resultWitness?.occurrence &&
            scalarContextAtDispatch.witness.revision === scalarAttemptAtDispatch.revision &&
            actualRevision === scalarAttemptAtDispatch.revision);
          const queryCacheable = scalarContextAtDispatch
            ? scalarQueryStillOwned
            : originAtDispatch.status === "valid" && originInvocationAtDispatch?.scalarDiscovery === null &&
              originInvocationAtDispatch.cancellationGenerationAtEntry === generationAtDispatch &&
              generationAtDispatch === evidence.runtimeState?.cancellationGeneration &&
              scalarAttemptPointerAtDispatch?.runtimeState !== evidence.runtimeState &&
              currentScalarAttempt?.runtimeState !== evidence.runtimeState ||
              originAtDispatch.status === "independent";
          if (queryCacheable) {
            observedDefinitionQueries.push({
              definitionId,
              occurrence: evidence.occurrence,
              revision: typeof actualRevision === "string" ? actualRevision : null,
              clientIdentity: evidence.identity,
            });
            if (observedDefinitionQueries.length > 128) observedDefinitionQueries.shift();
          }
          if (targetedWasArmedAtDispatch && targetedQueryFaultArmed &&
            targetedQueryFaultGeneration === targetedGenerationAtDispatch &&
            targetedQueryRequest === targetedRequestAtDispatch) {
            const request = targetedRequestAtDispatch;
            const matches = Boolean(request && request.generation === targetedQueryFaultGeneration &&
              request.definitionId === definitionId &&
              request.occurrence === targetedQueryFaultProbeValue.occurrence &&
              request.revision === targetedQueryFaultProbeValue.revision &&
              request.clientIdentity === evidence.identity &&
              evidence.occurrence === request.occurrence && evidence.revision === request.revision &&
              actualRevision === request.revision &&
              definitionId === targetedQueryFaultProbeValue.definitionId &&
              evidence.identity === targetedQueryFaultProbeValue.owningClientIdentity);
            if (!matches) {
              clearTargetedQueryReplyFault("query-identity-or-revision-mismatch");
            } else {
              targetedQueryFaultArmed = false;
              targetedQueryFaultProbeValue = {
                ...targetedQueryFaultProbeValue,
                armed: false,
                actualReplyRevision: String(actualRevision),
                consumed: true,
                resetReason: null,
              };
              throw new Error("Acceptance-only targeted grouped-summary query reply discarded after real Work query.");
            }
          }
          if (!scalarContextAtDispatch || !scalarAttemptAtDispatch ||
            !scalarQueryExpected || !scalarContextAtDispatch.valid ||
            !scalarAttemptIsCurrent(scalarAttemptAtDispatch)) return result;
          const attempt = scalarAttemptAtDispatch;
          if (attempt.phase !== "discovering" ||
            attempt.discoveryInvocationId !== scalarContextAtDispatch.invocationId ||
            attempt.clientIdentity !== evidence.identity ||
            scalarContextAtDispatch.witness.occurrence !== attempt.resultWitness?.occurrence ||
            scalarContextAtDispatch.witness.revision !== attempt.revision ||
            !scalarContextAtDispatch.bootstrapConfirmed ||
            (result as { revision?: unknown }).revision !== attempt.revision) {
            retireScalarAttempt(attempt);
            return result;
          }
          attempt.invokedDefinitionIds.push(definitionId);
          attempt.queryCallIds.push(scalarQueryCallId);
          if (attempt.invokedDefinitionIds.length === 1) {
            updateScalarProbe(attempt);
            return result;
          }
          if (attempt.invokedDefinitionIds.length !== 2) {
            retireScalarAttempt(attempt);
            return result;
          }
          if (attempt.holdRequested) {
            attempt.holdRequested = false;
            updateScalarProbe(attempt);
            await scalarRequerySecondReplyGate.pause();
            if (!scalarContextAtDispatch.valid || !scalarAttemptIsCurrent(attempt) ||
              attempt.discoveryInvocationId !== scalarContextAtDispatch.invocationId) return result;
          }
          attempt.phase = "consumed";
          attempt.discardedDefinitionId = definitionId;
          updateScalarProbe(attempt);
          throw new Error("Acceptance-only second grouped-summary query reply discarded after real Work query.");
        };
      }
      if (property === "observeOccurrence") {
        return async (...args: unknown[]): Promise<unknown> => {
          const originAtObserve = runtimeInvocationOrigin(evidence.identity, "observation");
          const originInvocationAtObserve = originAtObserve.invocation;
          const scalarAttemptAtObserve = currentScalarAttempt;
          const generationAtObserve = evidence.runtimeState?.cancellationGeneration ?? null;
          const observationCallId = ++acceptanceObservationSequence;
          latestObservationByClient.set(target, observationCallId);
          const targetedGenerationAtObserve = targetedQueryFaultGeneration;
          const targetedWasArmedAtObserve = targetedQueryFaultArmed;
          let result: unknown;
          try {
            result = await (value as (...args: unknown[]) => Promise<unknown>).apply(target, args);
          } catch (error) {
            if (targetedWasArmedAtObserve && targetedQueryFaultArmed &&
              targetedQueryFaultGeneration === targetedGenerationAtObserve) {
              clearTargetedQueryReplyFault("observation-failed");
            }
            throw error;
          }
          const occurrence = (result as { scope?: unknown }).scope;
          const revision = (result as { revision?: unknown }).revision;
          const attemptCompatible = scalarAttemptAtObserve === null ||
            scalarAttemptAtObserve.runtimeState !== evidence.runtimeState ||
            originAtObserve.status === "valid" && originInvocationAtObserve?.attemptAtEntry === scalarAttemptAtObserve &&
            scalarAttemptAtObserve.cancellationGenerationAtRequest === generationAtObserve;
          const observationOwned = originAtObserve.status === "valid" && originInvocationAtObserve !== null &&
            originInvocationAtObserve.cancellationGenerationAtEntry === generationAtObserve && attemptCompatible ||
            originAtObserve.status === "independent";
          const scalarAttemptStillOwned = scalarAttemptAtObserve?.runtimeState !== evidence.runtimeState ||
            currentScalarAttempt === scalarAttemptAtObserve;
          if (observationOwned && (originAtObserve.status === "independent" ||
            generationAtObserve === evidence.runtimeState?.cancellationGeneration) &&
            latestObservationByClient.get(target) === observationCallId && scalarAttemptStillOwned) {
            evidence.occurrence = typeof occurrence === "string" ? occurrence : null;
            evidence.revision = typeof revision === "string" ? revision : null;
          }
          if (targetedWasArmedAtObserve && targetedQueryFaultArmed &&
            targetedQueryFaultGeneration === targetedGenerationAtObserve &&
            (evidence.occurrence !== targetedQueryFaultProbeValue.occurrence || evidence.revision !== targetedQueryFaultProbeValue.revision)) {
            clearTargetedQueryReplyFault("occurrence-or-revision-replaced");
          }
          return result;
        };
      }
      if (property === "bootstrap") {
        return async (...args: unknown[]): Promise<unknown> => {
          const originAtDispatch = runtimeInvocationOrigin(evidence.identity, "bootstrap");
          const originInvocationAtDispatch = originAtDispatch.invocation;
          const scalarContextAtDispatch = originInvocationAtDispatch?.method === "discoverKeyedGroupedSums"
            ? originInvocationAtDispatch.scalarDiscovery
            : null;
          let result: unknown;
          try {
            result = await (value as (...args: unknown[]) => Promise<unknown>).apply(target, args);
          } catch (error) {
            const attempt = scalarContextAtDispatch?.attempt;
            if (scalarContextAtDispatch?.valid && attempt && scalarAttemptIsCurrent(attempt) &&
              attempt.discoveryInvocationId === scalarContextAtDispatch.invocationId) {
              scalarContextAtDispatch.valid = false;
              retireScalarAttempt(attempt);
            }
            throw error;
          }
          const attempt = scalarContextAtDispatch?.attempt;
          if (scalarContextAtDispatch?.valid && attempt && scalarAttemptIsCurrent(attempt) &&
            attempt.discoveryInvocationId === scalarContextAtDispatch.invocationId) {
            const snapshot = result as { revision?: unknown; keyed_grouped_sum_definition_ids?: unknown };
            const ids = Array.isArray(snapshot.keyed_grouped_sum_definition_ids)
              ? snapshot.keyed_grouped_sum_definition_ids
              : [];
            if (evidence.identity !== attempt.clientIdentity ||
              snapshot.revision !== attempt.revision || ids.length < 2 ||
              scalarContextAtDispatch.witness.occurrence !== attempt.resultWitness?.occurrence ||
              scalarContextAtDispatch.witness.revision !== attempt.revision) {
              scalarContextAtDispatch.valid = false;
              retireScalarAttempt(attempt);
            } else {
              scalarContextAtDispatch.bootstrapConfirmed = true;
              scalarContextAtDispatch.definitionIds = ids.map(String);
              scalarContextAtDispatch.nextDefinitionIndex = 0;
            }
          }
          return result;
        };
      }
      if (property === "inspectSpreadsheet") {
        return async (...args: unknown[]): Promise<unknown> => {
          const result = await (value as (...args: unknown[]) => Promise<unknown>).apply(target, args);
          await importInspectionGate.pause();
          return result;
        };
      }
      if (property === "createKeyedGroupedSum") {
        return async (...args: unknown[]): Promise<unknown> => {
          const result = await (value as (...args: unknown[]) => Promise<unknown>).apply(target, args);
          if (j4PostPublicationReadFaultRequested) {
            j4PostPublicationReadFaultRequested = false;
            j4PostPublicationReadFaultArmed = true;
            j4PostPublicationReadSkipped = false;
          }
          return result;
        };
      }
      if (property === "openProject") {
        return async (...args: unknown[]): Promise<unknown> => {
          if (targetedQueryFaultArmed) clearTargetedQueryReplyFault("workbook-replaced");
          const origin = runtimeInvocationOrigin(evidence.identity, "publication");
          if (origin.status === "valid" && currentScalarAttempt?.runtimeState === origin.state &&
            origin.invocation?.attemptAtEntry !== currentScalarAttempt) {
            retireScalarAttempt(currentScalarAttempt);
          }
          openProjectDispatchCount += 1;
          const result = await (value as (...args: unknown[]) => Promise<unknown>).apply(target, args);
          if (openReplyFaultArmed) {
            openReplyFaultArmed = false;
            throw new UnknownOperationOutcomeError("The dispatched open reply was lost after the real transport replied.");
          }
          return result;
        };
      }
      if (property === "importSpreadsheet") {
        return async (...args: unknown[]): Promise<unknown> => {
          if (targetedQueryFaultArmed) clearTargetedQueryReplyFault("workbook-replaced");
          const origin = runtimeInvocationOrigin(evidence.identity, "publication");
          if (origin.status === "valid" && currentScalarAttempt?.runtimeState === origin.state &&
            origin.invocation?.attemptAtEntry !== currentScalarAttempt) {
            retireScalarAttempt(currentScalarAttempt);
          }
          if (importBeforeDispatchFaultArmed) {
            importBeforeDispatchFaultArmed = false;
            throw new UnknownOperationOutcomeError("Import delivery outcome was unknown before dispatch; no candidate was sent.");
          }
          const loseReplyAfterDispatch = importReplyAfterDispatchFaultArmed;
          importReplyAfterDispatchFaultArmed = false;
          importSpreadsheetDispatchCount += 1;
          let result: unknown;
          try {
            result = await (value as (...args: unknown[]) => Promise<unknown>).apply(target, args);
          } finally {
            await importApplicationGate.pause();
          }
          if (loseReplyAfterDispatch) {
            throw new UnknownOperationOutcomeError("The dispatched import reply was lost after the real transport replied.");
          }
          if (importProjectionFaultRequested) {
            importProjectionFaultRequested = false;
            importProjectionFaultArmed = true;
          }
          return result;
        };
      }
      if (property === "closeProject") {
        return (...args: unknown[]): unknown => {
          const owner = evidence.runtimeState;
          if (owner) {
            const trackedCloseStillActive = [...owner.active].some((invocation) => invocation.seams.has("close-project"));
            if (!trackedCloseStillActive) {
              owner.cancellationGeneration += 1;
              if (currentScalarAttempt?.runtimeState === owner) retireScalarAttempt(currentScalarAttempt);
            }
          }
          return (value as (...args: unknown[]) => unknown).apply(target, args);
        };
      }
      if (property === "exportSpreadsheet") {
        return async (...args: unknown[]): Promise<unknown> => {
          if (spreadsheetExportFaultArmed) {
            spreadsheetExportFaultArmed = false;
            throw new Error("The acceptance probe rejected spreadsheet export once.");
          }
          return (value as (...args: unknown[]) => Promise<unknown>).apply(target, args);
        };
      }
      if (property === "previewCleanup") {
        return async (...args: unknown[]): Promise<unknown> => {
          if (cleanupPreviewFaultArmed) {
            cleanupPreviewFaultArmed = false;
            throw new Error("The acceptance probe rejected cleanup preview once.");
          }
          return (value as (...args: unknown[]) => Promise<unknown>).apply(target, args);
        };
      }
      if (property === "exportCanonicalTree") {
        return (...args: unknown[]): Promise<unknown> => {
          exportCanonicalDispatchCount += 1;
          return (value as (...args: unknown[]) => Promise<unknown>).apply(target, args);
        };
      }
      if (property === "exportProject") {
        return (...args: unknown[]): Promise<unknown> => {
          exportOpaqueDispatchCount += 1;
          return (value as (...args: unknown[]) => Promise<unknown>).apply(target, args);
        };
      }
      return value.bind(target);
    },
  });
}

/**
 * Genuine publication dispatch. When the reply-loss arm is set, the real call
 * is made exactly once, its real successful projection is retained
 * observationally and only then is an unknown outcome raised. The result is
 * never resent. This includes scalar edits and cleanup commits.
 */
async function dispatchPublication(
  target: PublicClient,
  method: string,
  args: unknown[],
): Promise<PublicationProjection> {
  dispatchCount += 1;
  if (targetedQueryFaultArmed) clearTargetedQueryReplyFault("publication-replaced-revision");
  const publicationOperationId = ++scalarOperationSequence;
  latestPublicationOperationId = publicationOperationId;
  const clientEvidenceAtDispatch = clientEvidence.get(target);
  const originAtDispatch = clientEvidenceAtDispatch
    ? runtimeInvocationOrigin(clientEvidenceAtDispatch.identity, "publication")
    : { status: "ambiguous-stale-unbound" as const, invocation: null, state: null };
  const originInvocationAtDispatch = originAtDispatch.invocation;
  const generationAtDispatch = originAtDispatch.state?.cancellationGeneration ?? null;
  const scalarAttemptPointerAtDispatch = currentScalarAttempt;
  const attemptAtDispatch = originAtDispatch.status === "valid" && originInvocationAtDispatch?.method === "edit"
    ? originInvocationAtDispatch.attemptAtEntry
    : null;
  const publicationEvidenceEligible = originAtDispatch.status === "valid" && originInvocationAtDispatch !== null &&
    originInvocationAtDispatch.cancellationGenerationAtEntry === generationAtDispatch ||
    originAtDispatch.status === "independent";
  const scalarAttemptScopeStillCurrent = scalarAttemptPointerAtDispatch?.runtimeState !== originAtDispatch.state ||
    currentScalarAttempt === scalarAttemptPointerAtDispatch;
  const dispatchStateStillCurrent = originAtDispatch.status === "independent" ||
    originAtDispatch.state?.cancellationGeneration === generationAtDispatch;
  let ownsScalarPublication = false;
  const currentAtDispatch = currentScalarAttempt;
  if (currentAtDispatch && currentAtDispatch.runtimeState === originAtDispatch.state &&
    originAtDispatch.status === "valid" && attemptAtDispatch !== currentAtDispatch) {
    retireScalarAttempt(currentAtDispatch, "ambiguous-runtime-invocation");
  }
  if (attemptAtDispatch && attemptAtDispatch === currentScalarAttempt && EDIT_METHODS.has(method) &&
    originAtDispatch.status === "valid" && originInvocationAtDispatch?.method === "edit" &&
    attemptAtDispatch.runtimeState === originAtDispatch.state &&
    attemptAtDispatch.cancellationGenerationAtRequest === generationAtDispatch) {
    const requestedRevision = typeof args[0] === "string" ? args[0] : null;
    if (attemptAtDispatch.phase === "requested" && attemptAtDispatch.editInvocationId !== null &&
      attemptAtDispatch.editInvocationId === originInvocationAtDispatch.id && attemptAtDispatch.requestWitness && clientEvidenceAtDispatch &&
      requestedRevision === attemptAtDispatch.requestWitness.revision &&
      clientEvidenceAtDispatch.identity === (attemptAtDispatch.clientIdentity ?? clientEvidenceAtDispatch.identity)) {
      ownsScalarPublication = true;
      attemptAtDispatch.phase = "publication-dispatched";
      attemptAtDispatch.clientIdentity = clientEvidenceAtDispatch.identity;
      attemptAtDispatch.publicationCallId = publicationOperationId;
      updateScalarProbe(attemptAtDispatch);
    } else {
      retireScalarAttempt(attemptAtDispatch);
    }
  }
  const call = (): Promise<PublicationProjection> =>
    (target[method as keyof PublicClient] as (...rest: unknown[]) => Promise<PublicationProjection>)(
      ...args,
    );
  try {
    if (loseArmed) {
      loseArmed = false;
      try {
        const receipt = await call();
        if (latestPublicationOperationId === publicationOperationId && publicationEvidenceEligible &&
          dispatchStateStillCurrent && scalarAttemptScopeStillCurrent) {
          lastReceiptValue = receipt;
        }
        throw new UnknownOperationOutcomeError(
          "The dispatched change reply was lost after the real transport replied.",
        );
      } finally {
        const resolve = settlePendingFault;
        settlePendingFault = null;
        resolve?.();
      }
    }
    const receipt = await call();
    if (latestPublicationOperationId === publicationOperationId && publicationEvidenceEligible &&
      dispatchStateStillCurrent && scalarAttemptScopeStillCurrent) {
      lastReceiptValue = receipt;
    }
    if (ownsScalarPublication && attemptAtDispatch && scalarAttemptIsCurrent(attemptAtDispatch)) {
      const revision = receipt.resulting_revision;
      if (typeof revision !== "string" || !revision || !attemptAtDispatch.requestWitness ||
        !attemptAtDispatch.clientIdentity || !attemptAtDispatch.publicationCallId) {
        retireScalarAttempt(attemptAtDispatch);
      } else {
        attemptAtDispatch.revision = revision;
        attemptAtDispatch.phase = "published";
        updateScalarProbe(attemptAtDispatch);
      }
    }
    return receipt;
  } catch (error) {
    if (ownsScalarPublication && attemptAtDispatch && scalarAttemptIsCurrent(attemptAtDispatch)) {
      retireScalarAttempt(attemptAtDispatch);
    }
    throw error;
  }
}

function columnId(view: WorkbookView, key: string): string | null {
  return view.table.columns.find((column) => column.key === key)?.id ?? null;
}

/** Target entity is the first actual table row that exposes all observed columns. */
function selectTarget(view: WorkbookView): string {
  for (const row of view.table.rows) {
    const entity = row.fields[0]?.target.entity ?? row.id;
    const complete = OBSERVED_COLUMN_KEYS.every((key) => {
      const id = columnId(view, key);
      return id !== null && row.fields.some((field) => field.target.field === id);
    });
    if (complete) return entity;
  }
  throw new Error("No projected table row exposes the impact/priority/notes columns.");
}

function fieldFor(batch: readonly FieldProjection[], entity: string, field: string): FieldProjection | null {
  return (
    batch.find(
      (candidate) => candidate.target.entity === entity && candidate.target.field === field,
    ) ?? null
  );
}

function storedNumber(field: FieldProjection | null): number | null {
  if (!field) return null;
  if (field.stored?.kind === "number") return field.stored.value;
  if (field.calculated?.status === "value") return field.calculated.value;
  return null;
}

function calculatedNumber(field: FieldProjection | null): number | null {
  if (!field) return null;
  if (field.calculated?.status === "value") return field.calculated.value;
  if (field.stored?.kind === "number") return field.stored.value;
  return null;
}

function storedText(field: FieldProjection | null): string | null {
  return field?.stored?.kind === "text" ? field.stored.value : null;
}

/** Actual runtime read plus a bounded field read and an explicit debug export. */
export async function observe(): Promise<AcceptanceObservation> {
  const { runtime } = requireWiring();
  const view = await runtime.read();
  const entity = selectTarget(view);
  const impactColumn = columnId(view, "impact");
  const priorityColumn = columnId(view, "priority");
  const notesColumn = columnId(view, "notes");
  if (!impactColumn || !priorityColumn || !notesColumn) {
    throw new Error("The open work does not project the impact/priority/notes columns.");
  }
  const witness = { occurrence: view.occurrence, revision: view.revision };
  const batch = await runtime.readFields(witness, [
    { entity, field: impactColumn },
    { entity, field: priorityColumn },
    { entity, field: notesColumn },
  ]);
  const tree = await runtime.exportCanonical(witness);
  return {
    occurrence: view.occurrence,
    revision: view.revision,
    entity,
    impact: storedNumber(fieldFor(batch.fields, entity, impactColumn)),
    priority: calculatedNumber(fieldFor(batch.fields, entity, priorityColumn)),
    notes: storedText(fieldFor(batch.fields, entity, notesColumn)),
    canonicalHash: await hashCanonicalFiles(tree.files),
  };
}

/** Generic real-kit observation; unlike the M1 probe, no column names are assumed. */
export async function runtimeSnapshot(): Promise<AcceptanceRuntimeSnapshot> {
  const { runtime } = requireWiring();
  const view = await runtime.read();
  const snapshot = await runtime.exportOpaque({ occurrence: view.occurrence, revision: view.revision });
  return { occurrence: view.occurrence, revision: view.revision, opaqueBytesHash: await hashBytes(snapshot.bytes) };
}

/** Readonly host observation; opaque bytes and their attachment are never decoded or rewritten. */
export async function savedSnapshot(name: string): Promise<AcceptanceSavedSnapshot | null> {
  const copy = await requireWiring().copies.readAny(name);
  if (!copy) return null;
  if (copy.kind === "opaque") {
    return {
      kind: "opaque",
      revision: copy.revision,
      bytesHash: await hashBytes(copy.bytes),
      presentation: copy.presentation ? structuredClone(copy.presentation) : null,
    };
  }
  return { kind: "canonical", revision: copy.revision, bytesHash: await hashCanonicalFiles(copy.files), presentation: null };
}

async function hashBytes(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function workMethodCounts(): Record<string, number> {
  return Object.fromEntries(workMethodInvocations);
}

/** Exercise the production appearance seam only; this helper has no runtime/host access. */
export function applyInterfaceProfile(input: unknown): boolean {
  const resolved = resolveInterfaceProfile(input);
  return resolved.ok && applyResolvedProfile(document.documentElement, resolved.value);
}

/** Hash of the durable bytes actually stored by the host, or null when absent. */
export async function savedHash(name: string): Promise<string | null> {
  const { copies } = requireWiring();
  const copy = await copies.read(name);
  if (!copy) return null;
  return hashCanonicalFiles(copy.files);
}

let saveFaultArmed = false;
let restoreTransaction: (() => void) | null = null;

function matchesHostCopyWrite(db: IDBDatabase, storeNames: string | string[], mode?: IDBTransactionMode): boolean {
  if (db.name !== LOCAL_COPIES_DB_NAME) return false;
  if (mode !== "readwrite") return false;
  const names = typeof storeNames === "string" ? [storeNames] : Array.from(storeNames);
  return names.includes(LOCAL_COPIES_STORE);
}

/**
 * Aborts the NEXT real local-copies readwrite transaction before commit by
 * wrapping only `IDBDatabase.prototype.transaction` for the duration of the
 * fault. Other databases, stores and readonly transactions are untouched.
 */
export function failNextSave(): void {
  if (saveFaultArmed) return;
  saveFaultArmed = true;
  const prototype = IDBDatabase.prototype;
  const original = prototype.transaction;
  const patched = function (
    this: IDBDatabase,
    storeNames: string | string[],
    mode?: IDBTransactionMode,
    options?: IDBTransactionOptions,
  ): IDBTransaction {
    const transaction = original.call(this, storeNames, mode, options);
    if (saveFaultArmed && matchesHostCopyWrite(this, storeNames, mode)) {
      saveFaultArmed = false;
      restore();
      queueMicrotask(() => {
        try {
          transaction.abort();
        } catch {
          // The transaction already settled; the fault is a no-op then.
        }
      });
    }
    return transaction;
  };
  prototype.transaction = patched as typeof original;
  restoreTransaction = (): void => {
    if (prototype.transaction === (patched as typeof original)) {
      prototype.transaction = original;
    }
    restoreTransaction = null;
  };
}

/** One-shot acceptance-only Prepare failure; the next export uses the real kit. */
export function failNextSpreadsheetExport(): void {
  spreadsheetExportFaultArmed = true;
}

/** One-shot acceptance-only cleanup preview failure; later previews use the real kit. */
export function failNextCleanupPreview(): void {
  cleanupPreviewFaultArmed = true;
}

export function deferNextImportInspection(): void {
  importInspectionGate.defer();
}

export function releaseImportInspection(): void {
  importInspectionGate.release();
}

export function deferNextImportApplication(): void {
  importApplicationGate.defer();
}

export function releaseImportApplication(): void {
  importApplicationGate.release();
}

export function deferNextCopyWrite(): void {
  copyWriteGate.defer();
}

export function releaseCopyWrite(): void {
  copyWriteGate.release();
}

function restore(): void {
  restoreTransaction?.();
}

function renderedCurrentness(): string | null {
  const fact = document.querySelector(
    '[data-testid^="cell:"][data-work-currentness], [data-testid^="brief:"][data-work-currentness]',
  );
  if (fact) return fact.getAttribute("data-work-currentness");
  return document.querySelector("[data-work-currentness]")?.getAttribute("data-work-currentness") ?? null;
}

function renderedDirty(): boolean {
  return document.querySelector("[data-work-dirty]")?.getAttribute("data-work-dirty") === "true";
}

/** Reads the real rendered save status, dirty state and fact currentness. */
export function saveObservation(): AcceptanceSaveObservation {
  const saveStatus = document.querySelector('[data-testid="save-status"]')?.textContent?.trim() ?? null;
  return {
    saveStatus,
    saved: saveStatus === "Saved on this device",
    dirty: renderedDirty(),
    currentness: renderedCurrentness(),
  };
}

/** Reads the real rendered operation outcome and whether facts claim currentness. */
export function unknownObservation(): AcceptanceUnknownObservation {
  const text = document.querySelector('[data-testid="operation-outcome"]')?.textContent?.trim() ?? "";
  const normalized = text.toLowerCase();
  const outcome = normalized.includes("unknown") || normalized.includes("needs review")
    ? "unknown"
    : normalized.includes("applying") || normalized.includes("pending")
      ? "pending"
      : "idle";
  const facts = document.querySelectorAll(
    '[data-testid^="cell:"][data-work-currentness], [data-testid^="brief:"][data-work-currentness]',
  );
  const staleValuesPresentedAsCurrent = Array.from(facts).some(
    (fact) => fact.getAttribute("data-work-currentness") === "current",
  );
  return {
    outcome,
    saved: saveObservation().saved,
    staleValuesPresentedAsCurrent,
    currentness: renderedCurrentness(),
  };
}

/** The last real publication projection dispatched through the public client. */
export function lastReceipt(): PublicationProjection | null {
  return lastReceiptValue ? { ...lastReceiptValue } : null;
}

export function executeRequestCount(): number {
  return dispatchCount;
}

export function loseNextExecuteReply(): void {
  if (loseArmed) return;
  loseArmed = true;
  pendingFault = new Promise<void>((resolve) => {
    settlePendingFault = resolve;
  });
}

export function loseNextOpenReply(): void {
  openReplyFaultArmed = true;
}

/**
 * Simulates delivery uncertainty before a candidate is dispatched. No import
 * call is made; this arm is deliberately distinct from reply loss.
 */
export function loseNextImportBeforeDispatch(): void {
  importReplyAfterDispatchFaultArmed = false;
  importBeforeDispatchFaultArmed = true;
}

/** Simulates a lost reply only after one real import dispatch has succeeded. */
export function loseNextImportReplyAfterDispatch(): void {
  importBeforeDispatchFaultArmed = false;
  importReplyAfterDispatchFaultArmed = true;
}

export function failNextImportProjection(): void {
  importProjectionFaultRequested = true;
  importProjectionFaultArmed = false;
}

export function failNextJ4PostPublicationRead(): void {
  j4PostPublicationReadFaultRequested = true;
  j4PostPublicationReadFaultArmed = false;
  j4PostPublicationReadSkipped = false;
}

/**
 * After the next acknowledged scalar publication, let the first real grouped
 * query return and discard the reply from the second real query.
 */
export function failSecondScalarRequeryReplyAfterFirst(): void {
  resetScalarRequeryFaultProbe();
  requestScalarAttempt();
}

export function deferSecondScalarRequeryReply(): void {
  if (!currentScalarAttempt || currentScalarAttempt.phase !== "requested") return;
  currentScalarAttempt.holdRequested = true;
  scalarRequerySecondReplyGate.defer();
}

export function releaseSecondScalarRequeryReply(): void {
  scalarRequerySecondReplyGate.release();
}

export function resetScalarRequeryFaultProbe(): void {
  const state = wiring ? runtimeStateFor(wiring.runtime) : currentScalarAttempt?.runtimeState ?? null;
  if (state) state.cancellationGeneration += 1;
  const attempt = currentScalarAttempt;
  if (attempt?.runtimeState === state) retireScalarAttempt(attempt);
}

export function scalarRequeryFaultProbe(): ScalarRequeryFaultProbe {
  const attempt = currentScalarAttempt;
  if (attempt) updateScalarProbe(attempt);
  return {
    ...scalarRequeryFaultProbeValue,
    suppliedWitness: scalarRequeryFaultProbeValue.suppliedWitness
      ? { ...scalarRequeryFaultProbeValue.suppliedWitness }
      : null,
    invokedDefinitionIds: [...scalarRequeryFaultProbeValue.invokedDefinitionIds],
  };
}

export function armTargetedQueryReplyFault(definitionId: string, occurrence: string, revision: string): void {
  resetTargetedQueryReplyFault();
  const priorQuery = [...observedDefinitionQueries].reverse().find((query) =>
    query.definitionId === definitionId && query.occurrence === occurrence && query.revision === revision,
  );
  const owner = priorQuery ? clientEvidenceByIdentity.get(priorQuery.clientIdentity) : undefined;
  if (!priorQuery || !owner || owner.occurrence !== occurrence || owner.revision !== revision) {
    targetedQueryFaultProbeValue = {
      armed: false,
      definitionId,
      occurrence,
      revision,
      owningClientIdentity: priorQuery?.clientIdentity ?? null,
      actualReplyRevision: null,
      receivedDefinitionId: null,
      receivedOccurrence: null,
      receivedRevision: null,
      consumed: false,
      resetReason: "prerequisite-unavailable",
    };
    return;
  }
  targetedQueryFaultArmed = true;
  targetedQueryFaultProbeValue = {
    armed: true,
    definitionId,
    occurrence,
    revision,
    owningClientIdentity: priorQuery.clientIdentity,
    actualReplyRevision: null,
    receivedDefinitionId: null,
    receivedOccurrence: null,
    receivedRevision: null,
    consumed: false,
    resetReason: null,
  };
}

export function resetTargetedQueryReplyFault(): void {
  targetedQueryFaultGeneration += 1;
  targetedQueryFaultArmed = false;
  targetedQueryRequest = null;
  targetedQueryFaultProbeValue = {
    armed: false,
    definitionId: null,
    occurrence: null,
    revision: null,
    owningClientIdentity: null,
    actualReplyRevision: null,
    receivedDefinitionId: null,
    receivedOccurrence: null,
    receivedRevision: null,
    consumed: false,
    resetReason: null,
  };
}

function clearTargetedQueryReplyFault(reason: string): void {
  targetedQueryFaultGeneration += 1;
  targetedQueryFaultArmed = false;
  targetedQueryRequest = null;
  targetedQueryFaultProbeValue = {
    ...targetedQueryFaultProbeValue,
    armed: false,
    consumed: false,
    resetReason: reason,
  };
}

export function targetedQueryFaultProbe(): TargetedQueryFaultProbe {
  return { ...targetedQueryFaultProbeValue };
}

export function queryDefinitionIds(): string[] {
  return [...queryDefinitionIdLog];
}

export function resetQueryDefinitionIds(): void {
  queryDefinitionIdLog.length = 0;
}

export function failNextOpenProjection(): void {
  openProjectionFaultArmed = true;
}

export function openProjectRequestCount(): number {
  return openProjectDispatchCount;
}

export function importSpreadsheetRequestCount(): number {
  return importSpreadsheetDispatchCount;
}

export function exportDispatchCounts(): { canonical: number; opaque: number } {
  return { canonical: exportCanonicalDispatchCount, opaque: exportOpaqueDispatchCount };
}

export function copyWriteDispatchCounts(): { canonical: number; opaque: number } {
  return { canonical: copyCanonicalDispatchCount, opaque: copyOpaqueDispatchCount };
}

export function acceptanceHarnessVersion(): string {
  return ACCEPTANCE_HARNESS_VERSION;
}

export function resetCoreFailureProbe(): void {
  lastCoreFailureProbe = null;
}

export function coreFailureProbe(): AcceptanceCoreFailureProbe | null {
  return lastCoreFailureProbe ? { ...lastCoreFailureProbe } : null;
}

function installRuntimeReadProbe(runtime: SheetRuntime): void {
  const originalRead = runtime.read;
  runtime.read = async function readWithAcceptanceProbe(): Promise<WorkbookView> {
    try {
      return await originalRead.call(runtime);
    } catch (error) {
      const cause = (error as { cause?: unknown } | null)?.cause as {
        name?: unknown;
        failure?: { code?: unknown };
      } | null;
      lastCoreFailureProbe = {
        name: error instanceof Error ? error.name : "unknown",
        causeName: typeof cause?.name === "string" ? cause.name : "unknown",
        causeFailureCode: typeof cause?.failure?.code === "string" ? cause.failure.code : null,
      };
      throw error;
    }
  };
}

/** Resolves only when the bounded real-dispatch / drop experiment has settled. */
export async function settleFaultWindow(): Promise<void> {
  await (pendingFault ?? Promise.resolve());
}

export function installAcceptance(next: AcceptanceWiring): void {
  if (!wrappedKitLoaders.has(next.kitLoader)) {
    throw new Error("Acceptance requires the registered wrapped kit loader for this runtime.");
  }
  const runtimeState = runtimeStateFor(next.runtime);
  const priorRuntime = loaderRuntimeBindings.get(next.kitLoader);
  if (priorRuntime && priorRuntime !== runtimeState) {
    throw new Error("A wrapped acceptance kit loader cannot be rebound to another runtime.");
  }
  loaderRuntimeBindings.set(next.kitLoader, runtimeState);
  wiring = next;
  installRuntimeReadProbe(next.runtime);
  const edit = next.runtime.edit;
  next.runtime.edit = async (witness, target, change) => {
    const invocation = currentRuntimeInvocation(next.runtime);
    const attempt = invocation?.attemptAtEntry ?? null;
    const editInvocationId = invocation?.id ?? null;
    if (attempt && (attempt.phase !== "requested" || attempt.editInvocationId !== editInvocationId ||
      !attempt.requestWitness || witness.occurrence !== attempt.requestWitness.occurrence ||
      witness.revision !== attempt.requestWitness.revision)) retireScalarAttempt(attempt);
    try {
      const view = await edit.call(next.runtime, witness, target, change);
      if (attempt && scalarAttemptIsCurrent(attempt)) {
        if (attempt.editInvocationId !== editInvocationId || attempt.phase !== "published" ||
          typeof view.occurrence !== "string" || typeof view.revision !== "string" ||
          view.revision !== attempt.revision || !attempt.requestWitness ||
          view.occurrence !== attempt.requestWitness.occurrence ||
          !attempt.clientIdentity || !attempt.publicationCallId) {
          retireScalarAttempt(attempt);
        } else {
          attempt.resultWitness = { occurrence: view.occurrence, revision: view.revision };
          attempt.phase = "acknowledged";
          updateScalarProbe(attempt);
        }
      }
      return view;
    } catch (error) {
      if (attempt && scalarAttemptIsCurrent(attempt)) retireScalarAttempt(attempt);
      throw error;
    }
  };
  const queryKeyedGroupedSum = next.runtime.queryKeyedGroupedSum;
  next.runtime.queryKeyedGroupedSum = (witness, definitionId) => {
    if (!targetedQueryFaultArmed) return queryKeyedGroupedSum.call(next.runtime, witness, definitionId);
    const generation = targetedQueryFaultGeneration;
    const probe = targetedQueryFaultProbeValue;
    targetedQueryFaultProbeValue = {
      ...targetedQueryFaultProbeValue,
      receivedDefinitionId: definitionId,
      receivedOccurrence: witness.occurrence,
      receivedRevision: witness.revision,
    };
    if (definitionId !== probe.definitionId || witness.occurrence !== probe.occurrence || witness.revision !== probe.revision) {
      clearTargetedQueryReplyFault("request-identity-or-revision-mismatch");
      return queryKeyedGroupedSum.call(next.runtime, witness, definitionId);
    }
    const owner = probe.owningClientIdentity;
    if (owner === null || targetedQueryRequest) {
      clearTargetedQueryReplyFault("request-prerequisite-unavailable");
      return queryKeyedGroupedSum.call(next.runtime, witness, definitionId);
    }
    const request: TargetedQueryRequest = {
      generation,
      definitionId,
      occurrence: witness.occurrence,
      revision: witness.revision,
      clientIdentity: owner,
    };
    targetedQueryRequest = request;
    return queryKeyedGroupedSum.call(next.runtime, witness, definitionId).catch((error: unknown) => {
      if (targetedQueryFaultArmed && targetedQueryFaultGeneration === generation) {
        clearTargetedQueryReplyFault("target-call-failed-before-consumption");
      }
      throw error;
    }).finally(() => {
      if (targetedQueryRequest === request) {
        targetedQueryRequest = null;
        if (targetedQueryFaultArmed && targetedQueryFaultGeneration === generation) {
          clearTargetedQueryReplyFault("target-call-not-consumed");
        }
      }
    });
  };
  const discoverKeyedGroupedSums = next.runtime.discoverKeyedGroupedSums;
  next.runtime.discoverKeyedGroupedSums = async (...args) => {
    if (targetedQueryFaultArmed) clearTargetedQueryReplyFault("discovery-replaced-target-call");
    const witness = args[0] as { occurrence?: unknown; revision?: unknown } | undefined;
    const invocation = currentRuntimeInvocation(next.runtime);
    let context: ScalarDiscoveryContext | null = null;
    const attempt = invocation?.attemptAtEntry ?? null;
    if (invocation && !invocation.ambiguous && attempt && scalarAttemptIsCurrent(attempt)) {
      if (attempt.phase !== "acknowledged" || typeof witness?.occurrence !== "string" ||
        typeof witness.revision !== "string" || !attempt.resultWitness ||
        witness.occurrence !== attempt.resultWitness.occurrence || witness.revision !== attempt.resultWitness.revision) {
        retireScalarAttempt(attempt);
      } else {
        const invocationId = ++scalarOperationSequence;
        attempt.phase = "discovering";
        attempt.discoveryInvocationId = invocationId;
        attempt.suppliedWitness = { occurrence: witness.occurrence, revision: witness.revision };
        context = {
          attempt,
          invocationId,
          witness: { occurrence: witness.occurrence, revision: witness.revision },
          runtimeInvocationId: invocation.id,
          valid: true,
          bootstrapConfirmed: false,
          definitionIds: [],
          nextDefinitionIndex: 0,
        };
        invocation.scalarDiscovery = context;
        updateScalarProbe(attempt);
      }
    }
    try {
      return await discoverKeyedGroupedSums.apply(next.runtime, args);
    } finally {
      if (context && context.valid && scalarAttemptIsCurrent(context.attempt) &&
        context.attempt.discoveryInvocationId === context.invocationId &&
        context.attempt.invokedDefinitionIds.length < 2) {
        retireScalarAttempt(context.attempt);
      }
    }
  };
  const create = next.copies.create;
  const createOpaque = next.copies.createOpaque;
  if (typeof create === "function") {
    next.copies.create = async (...args) => {
      copyCanonicalDispatchCount += 1;
      const result = await create.apply(next.copies, args);
      await copyWriteGate.pause();
      return result;
    };
  }
  if (typeof createOpaque === "function") {
    next.copies.createOpaque = async (...args) => {
      copyOpaqueDispatchCount += 1;
      const result = await createOpaque.apply(next.copies, args);
      await copyWriteGate.pause();
      return result;
    };
  }
  installRuntimeInvocationTracking(next.runtime);
  window.__tachikoAcceptance = {
    runtimeSnapshot,
    savedSnapshot,
    workMethodCounts,
    applyInterfaceProfile,
    observe,
    savedHash,
    failNextSave,
    failNextSpreadsheetExport,
    failNextCleanupPreview,
    deferNextImportInspection,
    releaseImportInspection,
    deferNextImportApplication,
    releaseImportApplication,
    deferNextCopyWrite,
    releaseCopyWrite,
    loseNextExecuteReply,
    loseNextOpenReply,
    loseNextImportBeforeDispatch,
    loseNextImportReplyAfterDispatch,
    failNextImportProjection,
    failNextOpenProjection,
    failNextJ4PostPublicationRead,
    failSecondScalarRequeryReplyAfterFirst,
    deferSecondScalarRequeryReply,
    releaseSecondScalarRequeryReply,
    resetScalarRequeryFaultProbe,
    scalarRequeryFaultProbe,
    armTargetedQueryReplyFault,
    resetTargetedQueryReplyFault,
    targetedQueryFaultProbe,
    queryDefinitionIds,
    resetQueryDefinitionIds,
    openProjectRequestCount,
    importSpreadsheetRequestCount,
    executeRequestCount,
    settleFaultWindow,
    saveObservation,
    unknownObservation,
    lastReceipt,
    exportDispatchCounts,
    copyWriteDispatchCounts,
    acceptanceHarnessVersion,
    resetCoreFailureProbe,
    coreFailureProbe,
  };
}
