/** A file the desktop host opened for the page, or why it could not. */
export type OpenedFile = { file: File } | { refused: string };

const TYPES: Record<string, string> = {
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/** `[status: 0 file, 1 refused][text length: u32 LE][name or message][bytes]`; empty when none is waiting. */
export function decodeOpenedFile(frame: Uint8Array): OpenedFile | null {
  if (frame.byteLength === 0) return null;
  if (frame.byteLength < 5) throw new Error("The opened file's reply is malformed.");
  const length = new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint32(1, true);
  if (frame.byteLength < 5 + length) throw new Error("The opened file's reply is malformed.");
  const text = new TextDecoder().decode(frame.subarray(5, 5 + length));
  if (frame[0] === 1) return { refused: text };
  const extension = text.split(".").pop()?.toLowerCase() ?? "";
  return { file: new File([frame.slice(5 + length)], text, { type: TYPES[extension] ?? "" }) };
}
