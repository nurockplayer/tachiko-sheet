// Differential parity: the same public kit client operations, with the same
// host-generated occurrence identities, run once through the vendored Web
// Worker/WASM runtime and once through the desktop's native channel into the
// real native Rust host. Every reply, refusal and exported byte must match.
//
// Requires the native harness: `cargo build --release --example frame_harness
// --manifest-path src-tauri/Cargo.toml`; FRAME_HARNESS overrides its path.
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NativeRuntimeChannel, type NativeRuntimeTransport } from "../../src/host/native-runtime.js";
import { openCanonicalTreeFromEntries } from "../../public/core-kit/experimental-client.js";
import { projectTransferToEntries, type CanonicalProjectTransferEntry } from "../../public/core-kit/host/project-transfer.js";
import { WorkerDesignerClient } from "../../public/core-kit/runtime/worker-client.js";
import { startDesignerWorker } from "../../public/core-kit/runtime/worker-runtime.js";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const targetDir = process.env.CARGO_TARGET_DIR ?? path.join(root, "src-tauri", "target");
const harness = process.env.FRAME_HARNESS ?? path.join(targetDir, "release", "examples", "frame_harness");

// ---- transports ----------------------------------------------------------

interface Harness { transport: NativeRuntimeTransport; close(): void }

function startHarness(): Harness {
  const child: ChildProcessWithoutNullStreams = spawn(harness, [], { stdio: ["pipe", "pipe", "inherit"] });
  let buffer = Buffer.alloc(0);
  const waiting: ((reply: { status: number; body: Buffer }) => void)[] = [];
  child.stdout.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 5) {
      const length = buffer.readUInt32LE(1);
      if (buffer.length < 5 + length) break;
      const reply = { status: buffer[0]!, body: Buffer.from(buffer.subarray(5, 5 + length)) };
      buffer = buffer.subarray(5 + length);
      waiting.shift()?.(reply);
    }
  });
  const call = (op: number, bytes: Uint8Array) => new Promise<{ status: number; body: Buffer }>((resolve) => {
    waiting.push(resolve);
    const head = Buffer.alloc(5);
    head[0] = op;
    head.writeUInt32LE(bytes.byteLength, 1);
    child.stdin.write(head);
    child.stdin.write(bytes);
  });
  return {
    transport: {
      attach: async () => Number((await call(0, new Uint8Array(0))).body.readBigUInt64LE(0)),
      dispatch: async (frame) => {
        const reply = await call(1, frame);
        if (reply.status !== 0) throw new Error(reply.body.toString("utf8"));
        return reply.body.buffer.slice(reply.body.byteOffset, reply.body.byteOffset + reply.body.byteLength) as ArrayBuffer;
      },
    },
    close: () => child.kill(),
  };
}

/** The vendored Worker runtime, run in-process behind a Worker-shaped pair. */
function wasmWorker(wasmUrl: string): () => Worker {
  return () => {
    const toScope = new EventTarget();
    const toClient = new EventTarget();
    const deliver = (target: EventTarget, data: unknown, transfer: Transferable[] = []) => {
      const copy = structuredClone(data, { transfer });
      setTimeout(() => target.dispatchEvent(new MessageEvent("message", { data: copy })), 0);
    };
    const scope = {
      addEventListener: (type: string, listener: EventListener) => toScope.addEventListener(type, listener),
      postMessage: (data: unknown, transfer?: Transferable[]) => deliver(toClient, data, transfer),
    };
    const global = globalThis as unknown as { self?: unknown };
    const saved = global.self;
    global.self = scope;
    try {
      startDesignerWorker(wasmUrl);
    } finally {
      global.self = saved;
    }
    return {
      addEventListener: (type: string, listener: EventListener) => toClient.addEventListener(type, listener),
      postMessage: (data: unknown, transfer?: Transferable[]) => deliver(toScope, data, transfer),
      terminate: () => undefined,
    } as unknown as Worker;
  };
}

// ---- scenario ------------------------------------------------------------

type Client = WorkerDesignerClient;
type Log = [string, unknown][];

function normalize(value: unknown): unknown {
  if (value instanceof ArrayBuffer) {
    return { bytes: value.byteLength, sha256: createHash("sha256").update(new Uint8Array(value)).digest("hex") };
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, normalize(inner)]));
  }
  return value;
}

async function step<T>(log: Log, label: string, action: () => Promise<T>): Promise<T | undefined> {
  try {
    const value = await action();
    log.push([label, normalize(value)]);
    return value;
  } catch (error) {
    const failure = (error as { failure?: unknown }).failure;
    log.push([label, { error: (error as Error).name, message: (error as Error).message, failure: failure ?? null }]);
    return undefined;
  }
}

interface Cell { target: { entity: string; field: string }; editable_scalar?: string | null }
interface Table { revision: string; collection: { id: string; key: string }; rows: { fields: Cell[] }[] }

const firstEditable = (table: Table | undefined, kind: string, row = 0) =>
  table?.rows[row]?.fields.find((cell) => cell.editable_scalar === kind)?.target;

async function scenario(client: Client, inputs: Inputs): Promise<Log> {
  const log: Log = [];
  await step(log, "observe before open", () => client.observeOccurrence());

  // A canonical project tree (the Sales example), its edits and every export.
  const opened = await step(log, "open sales tree", () => openCanonicalTreeFromEntries(client, inputs.sales));
  let revision = opened?.bootstrap.revision ?? "missing";
  await step(log, "observe", () => client.observeOccurrence());
  const table = await step(log, "query table", () => client.queryTable(opened!.table.collection.key)) as unknown as Table;
  const number = firstEditable(table, "number");
  const published = await step(log, "edit number", () => client.editNumber(revision, number!, "42"));
  await step(log, "stale edit refused", () => client.editNumber(revision, number!, "43"));
  revision = (published as { resulting_revision?: string } | undefined)?.resulting_revision ?? revision;
  await step(log, "query after edit", () => client.queryTable(opened!.table.collection.key));
  const tree = await step(log, "export canonical tree", () => client.exportCanonicalTree(revision));
  const project = await step(log, "export project", () => client.exportProject(revision));
  await step(log, "export project v3", () => client.exportProjectV3(revision));
  const portable = await step(log, "export portable ro", () => client.exportPortableRo(revision));
  await step(log, "stale export refused", () => client.exportProject("resident/0"));
  await step(log, "verify portable ro", () => client.verifyPortableRo(portable!.bytes));
  await step(log, "close", () => client.closeProject());
  await step(log, "observe after close", () => client.observeOccurrence());
  await step(log, "open portable ro", () => client.openPortableRo(portable!.bytes.slice(0)));
  await step(log, "inspect project", () => client.inspectProject(project!.bytes.slice(0)));
  await step(log, "open project", () => client.openProject(project!.bytes.slice(0)));
  await step(log, "reopen exported tree", () => openCanonicalTreeFromEntries(client, tree!.files));
  await step(log, "open garbage refused", () => client.openProject(new TextEncoder().encode("not a project").buffer));
  await step(log, "observe after refusal", () => client.observeOccurrence());

  // The 8,406 x 3 Text import, first/middle/last edits, exports and reopen.
  const options = { delimiter: ",", header: true };
  await step(log, "inspect csv", () => client.inspectSpreadsheet(inputs.csv.slice(0), "csv", options));
  const selection = { column_types: [["text", "text", "text"]], extra_columns: [[]] };
  const imported = await step(log, "import csv", () => client.importSpreadsheet(inputs.csv.slice(0), "csv", options, selection as never));
  revision = imported?.opened.bootstrap.revision ?? "missing";
  const key = imported!.opened.table.collection.key;
  const rows = await step(log, "query imported", () => client.queryTable(key)) as unknown as Table;
  for (const row of [0, 4203, 8405]) {
    const target = firstEditable(rows, "text", row);
    const edit = await step(log, `edit text row ${row}`, () => client.editText(revision, target!, `edited-${row}-雪`));
    revision = (edit as { resulting_revision?: string } | undefined)?.resulting_revision ?? revision;
  }
  const metadata = imported!.metadata;
  const collection = metadata.sheets[0]!.schema_id;
  await step(log, "export csv", () => client.exportSpreadsheet(revision, metadata, "csv", collection));
  await step(log, "export xlsx", () => client.exportSpreadsheet(revision, metadata, "xlsx", collection));
  const saved = await step(log, "export imported project", () => client.exportProject(revision));
  await step(log, "close imported", () => client.closeProject());
  await step(log, "inspect imported project", () => client.inspectImportedProject(saved!.bytes.slice(0), metadata));
  const reopened = await step(log, "open imported project", () => client.openImportedProject(saved!.bytes.slice(0), metadata));
  await step(log, "query reopened", () => client.queryTable(reopened!.table.collection.key));

  // Refusals and local bridge limits.
  await step(log, "inspect malformed csv", () => client.inspectSpreadsheet(new TextEncoder().encode('a,b\n"open\n').buffer, "csv", options));
  await step(log, "oversized command refused", () => client.queryTable("x".repeat(70_000)));
  await step(log, "xlsx import of the csv bytes refused", () => client.inspectSpreadsheet(inputs.csv.slice(0), "xlsx", options));
  return log;
}

// ---- run -------------------------------------------------------------------

interface Inputs { sales: CanonicalProjectTransferEntry[]; csv: ArrayBuffer }

async function entriesOf(folder: string): Promise<CanonicalProjectTransferEntry[]> {
  const entries: CanonicalProjectTransferEntry[] = [];
  async function walk(directory: string, prefix: string) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix + entry.name;
      if (entry.isDirectory()) await walk(path.join(directory, entry.name), `${relative}/`);
      else {
        const bytes = await readFile(path.join(directory, entry.name));
        entries.push({ path: relative, bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer });
      }
    }
  }
  await walk(folder, "");
  return entries;
}

let identity = 0;
async function run(createWorker: () => Worker, inputs: Inputs): Promise<Log> {
  identity = 0;
  const client = new WorkerDesignerClient(createWorker);
  try {
    return await scenario(client, inputs);
  } finally {
    client.close();
  }
}

const runnable = existsSync(harness);
describe.skipIf(!runnable)("native desktop runtime parity with the Web Worker/WASM runtime", () => {
  let work: string;
  let inputs: Inputs;
  let wasmUrl: string;

  beforeAll(async () => {
    work = await mkdtemp(path.join(tmpdir(), "tachiko-native-parity-"));
    execFileSync("python3", ["-I", path.join(root, "acceptance", "capacity-8406", "oracle.py"), "generate", path.join(work, "fixtures")], { stdio: "ignore" });
    const csv = await readFile(path.join(work, "fixtures", "source-8406.csv"));
    execFileSync("node", [path.join(root, "scripts", "copy-example-fixture.mjs")], { cwd: root, stdio: "ignore" });
    inputs = {
      sales: await entriesOf(path.join(root, "public", "examples", "sales-catalog")),
      csv: csv.buffer.slice(csv.byteOffset, csv.byteOffset + csv.byteLength) as ArrayBuffer,
    };
    const wasm = await readFile(path.join(root, "public", "core-kit", "designer_runtime.wasm"));
    wasmUrl = `data:application/wasm;base64,${wasm.toString("base64")}`;
    vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(
      () => `00000000-0000-4000-8000-${String(++identity).padStart(12, "0")}` as `${string}-${string}-${string}-${string}-${string}`,
    );
  }, 120_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    if (work) await rm(work, { recursive: true, force: true });
  });

  it("returns identical replies, refusals and exported bytes", async () => {
    const web = await run(wasmWorker(wasmUrl), inputs);
    const native = startHarness();
    let attaches = 0;
    let dispatches = 0;
    let desktop: Log;
    try {
      const counted: NativeRuntimeTransport = {
        attach: () => { attaches++; return native.transport.attach(); },
        dispatch: (frame) => { dispatches++; return native.transport.dispatch(frame); },
      };
      desktop = await run(() => new NativeRuntimeChannel(counted, projectTransferToEntries) as unknown as Worker, inputs);
    } finally {
      native.close();
    }
    expect(attaches).toBe(1);
    // Every step but the locally refused oversized command reached the native host.
    expect(dispatches).toBeGreaterThanOrEqual(web.length - 1);
    expect(web.map(([label]) => label)).toEqual(desktop.map(([label]) => label));
    for (let index = 0; index < web.length; index++) {
      expect(desktop[index], `step ${web[index]![0]}`).toEqual(web[index]);
    }
    // The scenario must really exercise success paths, not only matching failures.
    const failed = new Set(web.filter(([, value]) => (value as { error?: string } | undefined)?.error).map(([label]) => label));
    expect([...failed].sort()).toEqual([
      "inspect malformed csv",
      "observe after close",
      "observe before open",
      "open garbage refused",
      "oversized command refused",
      "stale edit refused",
      "stale export refused",
      "xlsx import of the csv bytes refused",
    ]);
  }, 300_000);
});
