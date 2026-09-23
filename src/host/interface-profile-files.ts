/** Local browser file effects for Interface Profile import and export. */
import {
  INTERFACE_PROFILE_IMPORT_MAX_BYTES,
  stageInterfaceProfileImport,
  type InterfaceProfileImportResult,
} from "../application/interface-profile-import.js";
import {
  INTERFACE_PROFILE_SUGGESTED_FILENAME,
  type ProfileExportResult,
} from "../application/interface-profile-export.js";

export type InterfaceProfileFileHostError = Readonly<{
  ok: false;
  kind: "host-error";
  code: "invalid-file-size" | "file-too-large" | "file-read-failed";
  message: string;
}>;

export type InterfaceProfileFileStageResult = InterfaceProfileImportResult | InterfaceProfileFileHostError;

/** Check metadata before asking the browser to allocate/read file contents. */
export async function stageInterfaceProfileFile(file: File): Promise<InterfaceProfileFileStageResult> {
  let size: number;
  try {
    size = file.size;
  } catch {
    return fileHostError("invalid-file-size", "This file could not be read.");
  }
  if (!Number.isSafeInteger(size) || size < 0) {
    return fileHostError("invalid-file-size", "This file could not be read.");
  }
  if (size > INTERFACE_PROFILE_IMPORT_MAX_BYTES) {
    return fileHostError("file-too-large", `Choose a profile file no larger than ${INTERFACE_PROFILE_IMPORT_MAX_BYTES} bytes.`);
  }

  let buffer: ArrayBuffer;
  try {
    buffer = await file.arrayBuffer();
  } catch {
    return fileHostError("file-read-failed", "This profile file could not be read.");
  }
  if (buffer.byteLength > INTERFACE_PROFILE_IMPORT_MAX_BYTES) {
    return fileHostError("file-too-large", `Choose a profile file no larger than ${INTERFACE_PROFILE_IMPORT_MAX_BYTES} bytes.`);
  }

  return stageInterfaceProfileImport(new Uint8Array(buffer));
}

function fileHostError(code: InterfaceProfileFileHostError["code"], message: string): InterfaceProfileFileHostError {
  return Object.freeze({ ok: false, kind: "host-error", code, message });
}

export const INTERFACE_PROFILE_DOWNLOAD_MIME = "application/json;charset=utf-8";

export type InterfaceProfileDownloadAnchor = {
  href: string;
  download: string;
  click(): void;
  remove(): void;
};

/** Narrow injectable surface for browser effects and their cleanup. */
export interface InterfaceProfileDownloadHost {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
  createAnchor(): InterfaceProfileDownloadAnchor;
  appendAnchor(anchor: InterfaceProfileDownloadAnchor): void;
}

export type InterfaceProfileDownloadResult =
  | Readonly<{ ok: true; kind: "download-requested"; filename: typeof INTERFACE_PROFILE_SUGGESTED_FILENAME }>
  | Readonly<{ ok: false; kind: "download-failed"; requestIssued: boolean; message: string }>;

const browserDownloadHost: InterfaceProfileDownloadHost = {
  createObjectURL: (blob) => URL.createObjectURL(blob),
  revokeObjectURL: (url) => URL.revokeObjectURL(url),
  createAnchor: () => document.createElement("a"),
  appendAnchor: (anchor) => document.body.append(anchor as HTMLAnchorElement),
};

/** Request a local download from the successful result of the pure encoder. */
export function requestInterfaceProfileDownload(
  encoded: Extract<ProfileExportResult, { ok: true }>,
  host: InterfaceProfileDownloadHost = browserDownloadHost,
): InterfaceProfileDownloadResult {
  if (
    encoded.kind !== "encoded-profile-export" ||
    encoded.filename !== INTERFACE_PROFILE_SUGGESTED_FILENAME ||
    !(encoded.bytes instanceof Uint8Array)
  ) {
    return Object.freeze({ ok: false, kind: "download-failed", requestIssued: false, message: "The profile export could not be downloaded." });
  }

  let objectUrl: string | null = null;
  let anchor: InterfaceProfileDownloadAnchor | null = null;
  let requestIssued = false;
  let failed = false;
  try {
    const bytes = new Uint8Array(encoded.bytes.byteLength);
    bytes.set(encoded.bytes);
    const blob = new Blob([bytes.buffer], { type: INTERFACE_PROFILE_DOWNLOAD_MIME });
    objectUrl = host.createObjectURL(blob);
    anchor = host.createAnchor();
    anchor.href = objectUrl;
    anchor.download = INTERFACE_PROFILE_SUGGESTED_FILENAME;
    host.appendAnchor(anchor);
    anchor.click();
    requestIssued = true;
  } catch {
    failed = true;
  }

  if (anchor !== null) {
    try { anchor.remove(); } catch { failed = true; }
  }
  if (objectUrl !== null) {
    try { host.revokeObjectURL(objectUrl); } catch { failed = true; }
  }

  if (failed) {
    return Object.freeze({
      ok: false,
      kind: "download-failed",
      requestIssued,
      message: requestIssued
        ? "The download was requested, but browser cleanup did not finish."
        : "The profile download could not be requested.",
    });
  }
  return Object.freeze({ ok: true, kind: "download-requested", filename: INTERFACE_PROFILE_SUGGESTED_FILENAME });
}
