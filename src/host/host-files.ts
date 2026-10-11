import { createContext, useContext } from "react";

/**
 * - `saved`: the host wrote the file where the person chose.
 * - `cancelled`: the person dismissed the Save panel, or leaving was decided;
 *   nothing was written.
 * - `requested`: a browser download was requested; the browser does not
 *   report whether it was saved.
 */
export type SaveOutcome = "saved" | "cancelled" | "requested";

/**
 * Where exports go. The composition root supplies the host's implementation;
 * the UI never inspects which host it is in.
 */
export interface HostFiles {
  /**
   * Save `content` under a name the person can change. Rejects with a
   * readable message when nothing was saved because of a failure.
   */
  saveFile(suggestedName: string, content: Blob | Promise<Blob>): Promise<SaveOutcome>;
}

/** The browser: an ordinary download of a fresh object URL. */
export const BROWSER_HOST_FILES: HostFiles = {
  async saveFile(suggestedName, content) {
    const blob = await content;
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = suggestedName;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 60_000);
    return "requested";
  },
};

export const HostFilesContext = createContext<HostFiles>(BROWSER_HOST_FILES);

export function useHostFiles(): HostFiles {
  return useContext(HostFilesContext);
}

/** The anchor-style download surface the profile export is written against. */
interface AnchorDownloadHost {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
  createAnchor(): { href: string; download: string; click(): void; remove(): void };
  appendAnchor(anchor: { href: string; download: string; click(): void; remove(): void }): void;
}

/**
 * Present `hostFiles` through an anchor-style download surface, for callers
 * written against one. A click hands the blob to the host; a failure is
 * reported through `onFailure`, since such callers cannot await it.
 */
export function anchorDownloadHost(hostFiles: HostFiles, onFailure: (message: string) => void): AnchorDownloadHost {
  const blobs = new Map<string, Blob>();
  let next = 0;
  return {
    createObjectURL: (blob) => {
      const url = `host-file:${next++}`;
      blobs.set(url, blob);
      return url;
    },
    revokeObjectURL: (url) => {
      blobs.delete(url);
    },
    createAnchor: () => {
      const anchor = {
        href: "",
        download: "",
        click() {
          const blob = blobs.get(anchor.href);
          if (!blob) throw new Error("The file to save is no longer available.");
          hostFiles.saveFile(anchor.download, blob).catch((error: unknown) => {
            onFailure(error instanceof Error && error.message ? error.message : "The file was not saved.");
          });
        },
        remove() {},
      };
      return anchor;
    },
    appendAnchor: () => {},
  };
}
