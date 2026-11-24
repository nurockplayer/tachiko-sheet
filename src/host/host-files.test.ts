// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { BROWSER_HOST_FILES } from "./host-files.js";

it("downloads the file when IndexedDB rejects the companion write", async () => {
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
  const open = vi.spyOn(indexedDB, "open").mockImplementation(() => {
    const request = {} as IDBOpenDBRequest;
    queueMicrotask(() => {
      Object.assign(request, { result: {
        transaction: () => ({ objectStore: () => ({ put: () => { throw new DOMException("Quota exceeded", "QuotaExceededError"); } }) }),
        close: () => {},
      } });
      request.onsuccess?.(new Event("success") as Event & { target: IDBOpenDBRequest });
    });
    return request;
  });
  try {
    const blob = new Blob(["work"]);
    expect(await BROWSER_HOST_FILES.saveFile("work.ro", blob, { snapshotDigest: "digest", metadata: { version: 1, sheets: [] } })).toBe("requested-without-companion");
    expect(create).toHaveBeenCalledWith(blob);
    expect(click).toHaveBeenCalledOnce();
  } finally { vi.restoreAllMocks(); }
});
