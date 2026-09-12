import type { CanonicalProjectFile } from "../contracts.js";

/** Opaque view over a copied byte buffer without interpreting its contents. */
export function bytesOf(source: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (ArrayBuffer.isView(source)) {
    return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  }
  return new Uint8Array(source);
}

/**
 * Deterministic debug hash of an opaque canonical tree. Entries are ordered by
 * path; each contributes its raw path bytes, a NUL separator and its raw bytes.
 * No entry is parsed, decoded or reinterpreted.
 */
export async function hashCanonicalFiles(files: readonly CanonicalProjectFile[]): Promise<string> {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error("The opaque canonical debug hash needs a secure context (crypto.subtle).");
  }
  const encoder = new TextEncoder();
  const ordered = [...files].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  const chunks: Uint8Array[] = [];
  let total = 0;
  const push = (part: Uint8Array): void => {
    chunks.push(part);
    total += part.byteLength;
  };
  for (const file of ordered) {
    push(encoder.encode(String(file.path)));
    push(new Uint8Array([0]));
    push(bytesOf(file.bytes));
    push(new Uint8Array([0]));
  }
  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
