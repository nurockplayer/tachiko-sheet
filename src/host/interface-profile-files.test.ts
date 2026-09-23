import { describe, expect, it, vi } from "vitest";
import { encodeInterfaceProfileExport } from "../application/interface-profile-export.js";
import { INTERFACE_PROFILE_IMPORT_MAX_BYTES } from "../application/interface-profile-import.js";
import { TACHIKO_COMPACT_PORCELAIN_PROFILE } from "../ui/interface-profile/profile.js";
import {
  INTERFACE_PROFILE_DOWNLOAD_MIME,
  stageInterfaceProfileFile,
  requestInterfaceProfileDownload,
  type InterfaceProfileDownloadAnchor,
  type InterfaceProfileDownloadHost,
} from "./interface-profile-files.js";

const profileBytes = (): Uint8Array => new TextEncoder().encode(JSON.stringify(TACHIKO_COMPACT_PORCELAIN_PROFILE));

function fakeFile(size: number, bytes: Uint8Array | (() => Promise<ArrayBuffer>)): File {
  const arrayBuffer = typeof bytes === "function"
    ? bytes
    : async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return { size, arrayBuffer } as File;
}

function successfulExport() {
  const result = encodeInterfaceProfileExport(TACHIKO_COMPACT_PORCELAIN_PROFILE);
  if (!result.ok) throw new Error("expected built-in profile export to encode");
  return result;
}

function fakeDownloadHost(options: { click?: () => void } = {}) {
  const anchor: InterfaceProfileDownloadAnchor = {
    href: "",
    download: "",
    click: options.click ?? vi.fn(),
    remove: vi.fn(),
  };
  const created: Blob[] = [];
  const revoked: string[] = [];
  const appended: InterfaceProfileDownloadAnchor[] = [];
  const host: InterfaceProfileDownloadHost = {
    createObjectURL: vi.fn((blob) => {
      created.push(blob);
      return "blob:local-profile-export";
    }),
    revokeObjectURL: vi.fn((url) => revoked.push(url)),
    createAnchor: vi.fn(() => anchor),
    appendAnchor: vi.fn((node) => appended.push(node)),
  };
  return { host, anchor, created, revoked, appended };
}

describe("interface profile file host effects", () => {
  it("rejects oversize File metadata before reading bytes", async () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(0));
    const result = await stageInterfaceProfileFile(fakeFile(INTERFACE_PROFILE_IMPORT_MAX_BYTES + 1, arrayBuffer));

    expect(result).toMatchObject({ ok: false, kind: "host-error", code: "file-too-large" });
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("checks the actual byte count after reading", async () => {
    const result = await stageInterfaceProfileFile(fakeFile(1, new Uint8Array(INTERFACE_PROFILE_IMPORT_MAX_BYTES + 1)));

    expect(result).toMatchObject({ ok: false, kind: "host-error", code: "file-too-large" });
  });

  it("returns a safe typed error when arrayBuffer rejects", async () => {
    const result = await stageInterfaceProfileFile(fakeFile(1, async () => { throw new Error("private browser detail"); }));

    expect(result).toEqual({
      ok: false,
      kind: "host-error",
      code: "file-read-failed",
      message: "This profile file could not be read.",
    });
    expect(JSON.stringify(result)).not.toContain("private browser detail");
  });

  it("stages valid bytes without applying or persisting them", async () => {
    const read = vi.fn(async () => {
      const bytes = profileBytes();
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    });
    const result = await stageInterfaceProfileFile(fakeFile(1, read));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected a staged profile");
    expect(result.kind).toBe("staged-candidate");
    expect(result.profile).toEqual(TACHIKO_COMPACT_PORCELAIN_PROFILE);
    expect(read).toHaveBeenCalledOnce();
  });

  it("returns malformed and safety admission errors from the pure staging boundary", async () => {
    const malformed = await stageInterfaceProfileFile(fakeFile(1, new TextEncoder().encode("{")));
    expect(malformed).toMatchObject({ ok: false, errors: [{ stage: "parse" }] });

    const unsafeProfile = {
      ...TACHIKO_COMPACT_PORCELAIN_PROFILE,
      colors: { ...TACHIKO_COMPACT_PORCELAIN_PROFILE.colors, "text.primary": "#FFFFFF" },
    };
    const unsafeBytes = new TextEncoder().encode(JSON.stringify(unsafeProfile));
    const unsafe = await stageInterfaceProfileFile(fakeFile(unsafeBytes.length, unsafeBytes));
    expect(unsafe.ok).toBe(false);
    if (!("errors" in unsafe)) throw new Error("expected safety admission to reject the unsafe profile");
    expect(unsafe.errors[0]?.stage).toBe("safety");
  });

  it("requests a fixed local download and removes the anchor and object URL", async () => {
    const fixture = fakeDownloadHost();
    const result = requestInterfaceProfileDownload(successfulExport(), fixture.host);

    expect(result).toEqual({ ok: true, kind: "download-requested", filename: "appearance.tachiko-profile.json" });
    expect(fixture.host.createObjectURL).toHaveBeenCalledOnce();
    expect(fixture.created[0]?.type).toBe(INTERFACE_PROFILE_DOWNLOAD_MIME);
    expect(await fixture.created[0]?.text()).toContain('"schemaVersion": 1');
    expect(fixture.anchor.href).toBe("blob:local-profile-export");
    expect(fixture.anchor.download).toBe("appearance.tachiko-profile.json");
    expect(fixture.anchor.click).toHaveBeenCalledOnce();
    expect(fixture.appended).toEqual([fixture.anchor]);
    expect(fixture.anchor.remove).toHaveBeenCalledOnce();
    expect(fixture.revoked).toEqual(["blob:local-profile-export"]);
  });

  it("reports request failure while still cleaning up the temporary anchor and object URL", () => {
    const fixture = fakeDownloadHost({ click: () => { throw new Error("blocked"); } });
    const result = requestInterfaceProfileDownload(successfulExport(), fixture.host);

    expect(result).toMatchObject({ ok: false, kind: "download-failed", requestIssued: false });
    expect(fixture.anchor.remove).toHaveBeenCalledOnce();
    expect(fixture.revoked).toEqual(["blob:local-profile-export"]);
  });

  it("reports cleanup failure separately from the already-issued request", () => {
    const fixture = fakeDownloadHost();
    fixture.host.revokeObjectURL = vi.fn(() => { throw new Error("cleanup blocked"); });
    const result = requestInterfaceProfileDownload(successfulExport(), fixture.host);

    expect(result).toMatchObject({ ok: false, kind: "download-failed", requestIssued: true });
    expect(fixture.anchor.remove).toHaveBeenCalledOnce();
  });
});
