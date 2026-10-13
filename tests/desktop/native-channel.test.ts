// Ordering and failure laws of the desktop's Worker-shaped native channel.
import { describe, expect, it, vi } from "vitest";
import { NativeRuntimeChannel, decodeFrame, encodeFrame, type NativeRuntimeTransport } from "../../src/host/native-runtime.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function replyFrame(reply: unknown, payload: Uint8Array = new Uint8Array(0)): ArrayBuffer {
  const json = encoder.encode(JSON.stringify(reply));
  const frame = new Uint8Array(4 + json.byteLength + payload.byteLength);
  new DataView(frame.buffer).setUint32(0, json.byteLength, true);
  frame.set(json, 4);
  frame.set(payload, 4 + json.byteLength);
  return frame.buffer;
}

function parseRequest(frame: Uint8Array) {
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  const headerLength = view.getUint32(0, true);
  const header = JSON.parse(decoder.decode(frame.subarray(4, 4 + headerLength))) as { kind: string; generation: number };
  const requestLength = view.getUint32(4 + headerLength, true);
  const request = frame.subarray(8 + headerLength, 8 + headerLength + requestLength);
  return { header, request: decoder.decode(request), payload: frame.subarray(8 + headerLength + requestLength) };
}

function collect(channel: NativeRuntimeChannel) {
  const messages: Record<string, unknown>[] = [];
  const errors: string[] = [];
  channel.addEventListener("message", (event) => messages.push((event as MessageEvent).data as Record<string, unknown>));
  channel.addEventListener("error", (event) => errors.push((event as unknown as { message: string }).message));
  return { messages, errors };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const ok = { status: "ok", response: { type: "fields", payload: {} } };

describe("native runtime channel", () => {
  it("dispatches strictly in posting order, one at a time, on one attached generation", async () => {
    const seen: string[] = [];
    let inFlight = 0;
    let attaches = 0;
    const transport: NativeRuntimeTransport = {
      attach: async () => { attaches++; return 7; },
      dispatch: async (frame) => {
        inFlight++;
        expect(inFlight).toBe(1);
        const { header, request } = parseRequest(frame);
        expect(header.generation).toBe(7);
        seen.push(request);
        await new Promise((resolve) => setTimeout(resolve, request.includes("slow") ? 20 : 0));
        inFlight--;
        return replyFrame(ok);
      },
    };
    const channel = new NativeRuntimeChannel(transport, () => []);
    const { messages } = collect(channel);
    channel.postMessage({ id: 1, kind: "command", request: { type: "slow" } });
    channel.postMessage({ id: 2, kind: "command", request: { type: "fast" } });
    channel.postMessage({ id: 3, kind: "observe_occurrence" });
    // Wait for all three replies rather than a fixed delay (slow CI runners).
    await vi.waitFor(() => expect(messages).toHaveLength(3), { timeout: 5_000, interval: 10 });
    expect(seen).toEqual(['{"type":"slow"}', '{"type":"fast"}', ""]);
    expect(messages.map((message) => message.id)).toEqual([1, 2, 3]);
    expect(attaches).toBe(1);
  });

  it("refuses oversized input locally, exactly like the WASM bridge, without dispatching", async () => {
    let dispatched = 0;
    const channel = new NativeRuntimeChannel({ attach: async () => 1, dispatch: async () => { dispatched++; return replyFrame(ok); } }, () => []);
    const { messages } = collect(channel);
    channel.postMessage({ id: 1, kind: "command", request: { type: "query_table", collection: "x".repeat(70_000) } });
    channel.postMessage({ id: 2, kind: "export_project", expected_revision: "r".repeat(70_000) });
    await settle();
    await settle();
    expect(dispatched).toBe(0);
    expect(messages).toEqual([
      { id: 1, status: "error", error: { code: "request_too_large", message: "The Designer request exceeds the private bridge byte limit.", current_revision: "unavailable", diagnostics: [] } },
      { id: 2, status: "error", error: { code: "request_too_large", message: "The expected revision exceeds the bridge limit.", current_revision: "unavailable", diagnostics: [] } },
    ]);
  });

  it("makes a transport failure terminal: no fabricated reply, later posts fail too", async () => {
    let calls = 0;
    const channel = new NativeRuntimeChannel({
      attach: async () => 1,
      dispatch: async () => { calls++; throw new Error("the runtime stopped and its work was discarded"); },
    }, () => []);
    const { messages, errors } = collect(channel);
    channel.postMessage({ id: 1, kind: "command", request: { type: "edit_scalar" } });
    channel.postMessage({ id: 2, kind: "observe_occurrence" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(messages).toEqual([]);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain("stopped unexpectedly");
    expect(calls).toBe(1);
  });

  it("checks export receipts against the returned bytes", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    let lie = false;
    const channel = new NativeRuntimeChannel({
      attach: async () => 1,
      dispatch: async () => replyFrame({ status: "ok", response: { type: "project_exported", payload: { revision: "resident/1", byte_length: lie ? 4 : 3 } } }, bytes),
    }, () => []);
    const { messages } = collect(channel);
    channel.postMessage({ id: 1, kind: "export_project", expected_revision: "resident/1" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    lie = true;
    channel.postMessage({ id: 2, kind: "export_project", expected_revision: "resident/1" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(messages[0]).toMatchObject({ id: 1, status: "project_exported", export: { revision: "resident/1" } });
    expect(new Uint8Array((messages[0] as { export: { bytes: ArrayBuffer } }).export.bytes)).toEqual(bytes);
    expect(messages[1]).toMatchObject({ id: 2, status: "error", error: { code: "worker_failure", message: "Designer project export length did not match its receipt." } });
  });

  it("detaches transferred buffers like a Worker and stops after terminate", async () => {
    let dispatched = 0;
    const channel = new NativeRuntimeChannel({ attach: async () => 1, dispatch: async () => { dispatched++; return replyFrame(ok); } }, () => []);
    const { errors } = collect(channel);
    const bytes = new Uint8Array([9, 9]).buffer;
    channel.postMessage({ id: 1, kind: "inspect_project", bytes }, [bytes]);
    expect(bytes.byteLength).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 5));
    channel.terminate();
    channel.postMessage({ id: 2, kind: "observe_occurrence" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(dispatched).toBe(1);
    expect(errors).toEqual(["The Designer runtime was closed."]);
  });

  it("fences termination during attach and during dispatch", async () => {
    let releaseAttach!: (generation: number) => void;
    let dispatched = 0;
    const attaching = new NativeRuntimeChannel({
      attach: () => new Promise((resolve) => { releaseAttach = resolve; }),
      dispatch: async () => { dispatched++; return replyFrame(ok); },
    }, () => []);
    const first = collect(attaching);
    attaching.postMessage({ id: 1, kind: "command", request: { type: "edit_scalar" } });
    await settle();
    attaching.terminate();
    releaseAttach(1);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(dispatched).toBe(0);
    expect(first.messages).toEqual([]);

    let releaseDispatch!: (frame: ArrayBuffer) => void;
    const running = new NativeRuntimeChannel({
      attach: async () => 1,
      dispatch: () => new Promise((resolve) => { releaseDispatch = resolve; }),
    }, () => []);
    const second = collect(running);
    running.postMessage({ id: 1, kind: "command", request: { type: "edit_scalar" } });
    await new Promise((resolve) => setTimeout(resolve, 5));
    running.terminate();
    releaseDispatch(replyFrame(ok));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(second.messages).toEqual([]);
  });

  it("routes by the kind captured when the message was posted", async () => {
    const kinds: string[] = [];
    const channel = new NativeRuntimeChannel({
      attach: async () => 1,
      dispatch: async (frame) => { kinds.push(parseRequest(frame).header.kind); return replyFrame(ok); },
    }, () => []);
    collect(channel);
    const message = { id: 1, kind: "observe_occurrence" };
    channel.postMessage(message);
    message.kind = "close_project";
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(kinds).toEqual(["observe_occurrence"]);
  });

  it("frames round-trip", () => {
    const frame = encodeFrame("spreadsheet", 3, encoder.encode('{"type":"inspect"}'), new Uint8Array([1, 2]));
    expect(parseRequest(frame)).toMatchObject({ header: { kind: "spreadsheet", generation: 3 }, request: '{"type":"inspect"}' });
    const decoded = decodeFrame(replyFrame({ status: "closed" }, new Uint8Array([5])));
    expect(decoded.reply).toEqual({ status: "closed" });
    expect([...decoded.payload]).toEqual([5]);
    expect(() => decodeFrame(new ArrayBuffer(2))).toThrow("truncated");
  });
});
