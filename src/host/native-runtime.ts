/**
 * Desktop binding of the intact public core kit to the native Rust runtime.
 *
 * The kit's own `WorkerDesignerClient` is reused unchanged. Instead of a Web
 * Worker running the WASM bridge, it is given a Worker-shaped channel that
 * forwards each message to the desktop host, where the same Tachiko Work Rust
 * runtime runs natively. This module is a transport port of the kit's
 * `worker-runtime.js` + `wasm-bridge.js`: it encodes exactly the bytes the WASM
 * bridge would write, applies the same local size refusals and receipt checks,
 * and posts back exactly the reply shapes the Worker would post. It owns no
 * meaning, validation, revision or publication; Rust remains the authority.
 *
 * Ordering and failure laws:
 * - messages are snapshotted synchronously and dispatched strictly FIFO, one at
 *   a time, so the host observes the same order a Worker would;
 * - every channel attaches to a fresh host generation; the host refuses frames
 *   from an older generation, so a reload or replaced channel cannot reach the
 *   current resident occurrence;
 * - a transport failure is terminal: pending and later operations reject with
 *   a Worker `error`, never with a fabricated reply, so a mutation in flight is
 *   an unknown outcome and is never replayed.
 */
import type { CoreKit, KitLoader } from "../contracts.js";
import { PUBLIC_CLIENT_ENTRY } from "../core-loader.js";
import type { CanonicalProjectTransferEntry } from "../../public/core-kit/host/project-transfer.js";
import type { DesignerWorkerFactory, WorkerDesignerClient } from "../../public/core-kit/runtime/worker-client.js";

export const PUBLIC_WORKER_CLIENT_ENTRY = "/core-kit/runtime/worker-client.js";
export const PUBLIC_PROJECT_TRANSFER_ENTRY = "/core-kit/host/project-transfer.js";

const MAX_WIRE_REQUEST_BYTES = 65_536;
const MAX_METADATA_REQUEST_BYTES = 4 * 1024 * 1024;
const MAX_PROJECT_TRANSFER_BYTES = 64 * 1024 * 1024;

/** The desktop host's two private runtime commands. */
export interface NativeRuntimeTransport {
  /** Start a fresh host generation, destroying any previous resident occurrence. */
  attach(): Promise<number>;
  /** Run one framed operation on the current generation and return its framed reply. */
  dispatch(frame: Uint8Array): Promise<ArrayBuffer>;
}

type ProjectTransferToEntries = (input: ArrayBuffer) => CanonicalProjectTransferEntry[];

/** A message as posted by the kit's `WorkerDesignerClient`. */
interface ClientMessage {
  id: number;
  kind: string;
  [field: string]: unknown;
}

interface WireFailure {
  code: string;
  message: string;
  current_revision: string;
  diagnostics: unknown[];
}

/** A decoded Rust wire reply; only the fields this transport inspects are typed. */
interface WireReply {
  status: string;
  response?: { type: string; payload?: Record<string, unknown> };
  error?: WireFailure;
}

interface ExportReceipt {
  revision: unknown;
  byte_length: unknown;
  ledger?: unknown;
}

function receiptOf(reply: WireReply): { type: string; receipt: ExportReceipt } {
  const response = reply.response;
  if (reply.status !== "ok" || response === undefined) throw new Error("Expected an export receipt.");
  return { type: response.type, receipt: (response.payload ?? {}) as unknown as ExportReceipt };
}

/** Bytes snapshotted when the client posts, plus how to finish the reply. */
type Prepared =
  | { local: Record<string, unknown> }
  | { request: Uint8Array; payload: Uint8Array; finish: (reply: WireReply, payload: Uint8Array) => Record<string, unknown> };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function tooLargeReply(message: string): Record<string, unknown> {
  return {
    status: "error",
    error: { code: "request_too_large", message, current_revision: "unavailable", diagnostics: [] },
  };
}

function bytesOf(value: unknown): Uint8Array {
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  return new Uint8Array(0);
}

function passThrough(reply: WireReply): Record<string, unknown> {
  return { ...reply };
}

function exportedBytes(reply: WireReply, payload: Uint8Array, expectedType: string, label: string): { revision: unknown; bytes: ArrayBuffer } {
  const { type, receipt } = receiptOf(reply);
  if (type !== expectedType) {
    throw new Error(`Expected '${expectedType}' response, received '${type}'.`);
  }
  if (payload.byteLength !== receipt.byte_length) {
    throw new Error(`Designer ${label} export length did not match its receipt.`);
  }
  return { revision: receipt.revision, bytes: payload.slice().buffer };
}

/**
 * Translate one client message into the exact bridge input, or a local
 * refusal, mirroring `wasm-bridge.js` limits and encodings.
 */
export function prepareMessage(message: ClientMessage, toEntries: ProjectTransferToEntries): Prepared | null {
  switch (message.kind) {
    case "spreadsheet": {
      const operation = message.operation as { type?: string };
      const bytes = bytesOf(message.bytes);
      const maximum = operation.type === "export" || operation.type === "inspect_project" || operation.type === "open_project"
        ? MAX_METADATA_REQUEST_BYTES : MAX_WIRE_REQUEST_BYTES;
      const request = encoder.encode(JSON.stringify(operation));
      if (bytes.byteLength > MAX_PROJECT_TRANSFER_BYTES || request.byteLength > maximum) {
        return { local: tooLargeReply("The spreadsheet request exceeds the private bridge limits.") };
      }
      return {
        request,
        payload: bytes,
        finish: (reply, payload) => {
          if (reply.status !== "ok" || reply.response?.type !== "spreadsheet_exported") return passThrough(reply);
          const { receipt } = receiptOf(reply);
          if (!Number.isSafeInteger(receipt.byte_length) || (receipt.byte_length as number) < 0 ||
            (receipt.byte_length as number) > MAX_PROJECT_TRANSFER_BYTES) {
            throw new Error("Invalid spreadsheet export length.");
          }
          if (payload.byteLength !== receipt.byte_length) {
            throw new Error("Designer spreadsheet export length did not match its receipt.");
          }
          return { status: "spreadsheet_exported", export: { revision: receipt.revision, bytes: payload.slice().buffer, ledger: receipt.ledger } };
        },
      };
    }
    case "command": {
      const request = encoder.encode(JSON.stringify(message.request));
      if (request.byteLength > MAX_WIRE_REQUEST_BYTES) {
        return { local: tooLargeReply("The Designer request exceeds the private bridge byte limit.") };
      }
      return { request, payload: new Uint8Array(0), finish: passThrough };
    }
    case "inspect_project":
    case "verify_portable_ro": {
      const bytes = bytesOf(message.bytes);
      if (bytes.byteLength > MAX_PROJECT_TRANSFER_BYTES) {
        return { local: tooLargeReply("The project exceeds the private 64 MiB host transfer boundary.") };
      }
      return { request: new Uint8Array(0), payload: bytes, finish: passThrough };
    }
    case "open_project":
    case "open_local_document":
    case "open_portable_ro": {
      const bytes = bytesOf(message.bytes);
      if (bytes.byteLength > MAX_PROJECT_TRANSFER_BYTES) {
        return { local: tooLargeReply("The project exceeds the private 64 MiB host transfer boundary.") };
      }
      const occurrence = encoder.encode(String(message.occurrence_id));
      if (occurrence.byteLength > MAX_WIRE_REQUEST_BYTES) {
        return { local: tooLargeReply("The host occurrence identity exceeds the bridge limit.") };
      }
      return { request: occurrence, payload: bytes, finish: passThrough };
    }
    case "export_project":
    case "export_project_v3":
    case "export_canonical_tree":
    case "export_portable_ro": {
      const revision = encoder.encode(String(message.expected_revision));
      if (revision.byteLength > MAX_WIRE_REQUEST_BYTES) {
        return { local: tooLargeReply("The expected revision exceeds the bridge limit.") };
      }
      const kind = message.kind;
      return {
        request: revision,
        payload: new Uint8Array(0),
        finish: (reply, payload) => {
          if (reply.status === "error") return passThrough(reply);
          if (kind === "export_canonical_tree") {
            const exported = exportedBytes(reply, payload, "canonical_tree_exported", "canonical tree");
            return { status: "canonical_tree_exported", export: { revision: exported.revision, files: toEntries(exported.bytes) } };
          }
          if (kind === "export_portable_ro") {
            return { status: "portable_ro_exported", export: exportedBytes(reply, payload, "portable_ro_exported", "portable .ro") };
          }
          return { status: "project_exported", export: exportedBytes(reply, payload, "project_exported", "project") };
        },
      };
    }
    case "observe_occurrence":
      return { request: new Uint8Array(0), payload: new Uint8Array(0), finish: passThrough };
    case "close_project":
      return { request: new Uint8Array(0), payload: new Uint8Array(0), finish: () => ({ status: "closed" }) };
    default:
      // The Worker runtime ignores unknown kinds; no reply is ever posted.
      return null;
  }
}

/** `[u32 header][header JSON][u32 request][request][payload]`, little-endian. */
export function encodeFrame(kind: string, generation: number, request: Uint8Array, payload: Uint8Array): Uint8Array {
  const header = encoder.encode(JSON.stringify({ kind, generation }));
  const frame = new Uint8Array(4 + header.byteLength + 4 + request.byteLength + payload.byteLength);
  const view = new DataView(frame.buffer);
  view.setUint32(0, header.byteLength, true);
  frame.set(header, 4);
  view.setUint32(4 + header.byteLength, request.byteLength, true);
  frame.set(request, 8 + header.byteLength);
  frame.set(payload, 8 + header.byteLength + request.byteLength);
  return frame;
}

/** `[u32 reply][reply JSON][payload]`, little-endian. */
export function decodeFrame(input: ArrayBuffer): { reply: WireReply; payload: Uint8Array } {
  if (input.byteLength < 4) throw new Error("The native runtime reply frame is truncated.");
  const length = new DataView(input).getUint32(0, true);
  if (4 + length > input.byteLength) throw new Error("The native runtime reply frame is truncated.");
  const reply = JSON.parse(decoder.decode(new Uint8Array(input, 4, length))) as WireReply;
  return { reply, payload: new Uint8Array(input, 4 + length) };
}

function errorEvent(message: string): Event {
  const event = new Event("error");
  Object.defineProperty(event, "message", { value: message });
  return event;
}

/**
 * The Worker-shaped object handed to `WorkerDesignerClient`. Only the members
 * that client uses are implemented.
 */
export class NativeRuntimeChannel extends EventTarget {
  readonly #transport: NativeRuntimeTransport;
  readonly #toEntries: ProjectTransferToEntries;
  #generation: Promise<number> | null = null;
  #tail: Promise<void> = Promise.resolve();
  #failure: string | null = null;

  constructor(transport: NativeRuntimeTransport, toEntries: ProjectTransferToEntries) {
    super();
    this.#transport = transport;
    this.#toEntries = toEntries;
  }

  postMessage(message: ClientMessage, transfer: Transferable[] = []): void {
    let prepared: Prepared | null;
    try {
      prepared = prepareMessage(message, this.#toEntries);
    } catch (error) {
      prepared = { local: workerFailure(error) };
    }
    // A Worker postMessage detaches transferred buffers; keep that contract.
    if (transfer.length > 0) structuredClone(transfer, { transfer });
    if (prepared === null) return;
    const { id, kind } = message;
    const step = prepared;
    this.#tail = this.#tail.then(() => this.#run(id, kind, step));
  }

  terminate(): void {
    this.#failure ??= "The Designer runtime was closed.";
  }

  async #run(id: number, kind: string, prepared: Prepared): Promise<void> {
    if (this.#failure !== null) {
      this.dispatchEvent(errorEvent(this.#failure));
      return;
    }
    if ("local" in prepared) {
      this.#post({ id, ...prepared.local });
      return;
    }
    let decoded: { reply: WireReply; payload: Uint8Array };
    try {
      this.#generation ??= this.#transport.attach();
      const generation = await this.#generation;
      // Terminated while attaching: nothing may be dispatched any more.
      if (this.#failure !== null) {
        this.dispatchEvent(errorEvent(this.#failure));
        return;
      }
      const frame = encodeFrame(kind, generation, prepared.request, prepared.payload);
      decoded = decodeFrame(await this.#transport.dispatch(frame));
      // Terminated while the host ran it: the client already rejected the call.
      if (this.#failure !== null) return;
    } catch (error) {
      if (this.#failure !== null) return;
      this.#failure = error instanceof Error && error.message
        ? `The native Designer runtime stopped unexpectedly: ${error.message}`
        : "The native Designer runtime stopped unexpectedly.";
      this.dispatchEvent(errorEvent(this.#failure));
      return;
    }
    let reply: Record<string, unknown>;
    try {
      reply = prepared.finish(decoded.reply, decoded.payload);
    } catch (error) {
      reply = workerFailure(error);
    }
    this.#post({ id, ...reply });
  }

  #post(data: Record<string, unknown>): void {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
}

function workerFailure(error: unknown): Record<string, unknown> {
  return {
    status: "error",
    error: {
      code: "worker_failure",
      message: error instanceof Error ? error.message : String(error),
      current_revision: "unavailable",
      diagnostics: [],
    },
  };
}

type WorkerClientModule = { WorkerDesignerClient: new (createWorker: DesignerWorkerFactory) => WorkerDesignerClient };
type ProjectTransferModule = { projectTransferToEntries: ProjectTransferToEntries };

/**
 * Load the intact public kit and replace only its Worker factory. The public
 * client's canonical-tree preflight is preserved exactly as the kit defines it.
 */
export function createNativeKitLoader(transport: NativeRuntimeTransport): KitLoader {
  return async (): Promise<CoreKit> => {
    const kit = (await import(/* @vite-ignore */ PUBLIC_CLIENT_ENTRY)) as CoreKit;
    const { WorkerDesignerClient } = (await import(/* @vite-ignore */ PUBLIC_WORKER_CLIENT_ENTRY)) as WorkerClientModule;
    const { projectTransferToEntries } = (await import(/* @vite-ignore */ PUBLIC_PROJECT_TRANSFER_ENTRY)) as ProjectTransferModule;
    if (typeof kit.openCanonicalTreeFromEntries !== "function" || typeof WorkerDesignerClient !== "function" ||
      typeof projectTransferToEntries !== "function") {
      throw new Error("The pinned core kit entry did not expose its public client parts.");
    }
    class NativeExperimentalDesignerClient extends WorkerDesignerClient {
      async openCanonicalTree(files: readonly CanonicalProjectTransferEntry[]) {
        return kit.openCanonicalTreeFromEntries(this, files);
      }
    }
    const createExperimentalDesignerClient = () => new NativeExperimentalDesignerClient(
      () => new NativeRuntimeChannel(transport, projectTransferToEntries) as unknown as Worker,
    ) as unknown as ReturnType<CoreKit["createExperimentalDesignerClient"]>;
    return { ...kit, createExperimentalDesignerClient };
  };
}
