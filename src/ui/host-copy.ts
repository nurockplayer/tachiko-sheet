import { createContext, useContext } from "react";

/**
 * Wording that names where the Sheet runs and how to retry. The host supplies
 * it from the composition root; the UI never inspects which host it is in.
 */
export interface HostCopy {
  savedCopiesLocation: string;
  savedCopiesRetry: string;
  startupFailedTitle: string;
  startupFailedRetry: string;
  copiesScope: string;
  createCopyScope: string;
  exportConsent: string;
  appearanceScope: string;
  appearanceSessionReset: string;
}

export const BROWSER_HOST_COPY: HostCopy = {
  savedCopiesLocation: "Saved in this browser on this device.",
  savedCopiesRetry: "They may still be in this browser. Try again, or reload the page.",
  startupFailedTitle: "Tachiko couldn’t start in this browser",
  startupFailedRetry: "Reload the page to try again.",
  copiesScope: "Copies: this browser on this device",
  createCopyScope: "Creates a new copy in this browser profile.",
  exportConsent: "Review changes and warnings before downloading the file.",
  appearanceScope: "For this browser on this device.",
  appearanceSessionReset: "It may reset when this browser is reopened.",
};

export const DESKTOP_HOST_COPY: HostCopy = {
  savedCopiesLocation: "Saved in Tachiko Sheet on this Mac.",
  savedCopiesRetry: "They may still be on this Mac. Try again, or quit and reopen Tachiko Sheet.",
  startupFailedTitle: "Tachiko Sheet couldn’t start",
  startupFailedRetry: "Quit and reopen Tachiko Sheet to try again.",
  copiesScope: "Copies: Tachiko Sheet on this Mac",
  createCopyScope: "Creates a new copy in Tachiko Sheet on this Mac.",
  exportConsent: "Review changes and warnings, then choose where to save the file.",
  appearanceScope: "For Tachiko Sheet on this Mac.",
  appearanceSessionReset: "It may reset when Tachiko Sheet is reopened.",
};

export const HostCopyContext = createContext<HostCopy>(BROWSER_HOST_COPY);

export function useHostCopy(): HostCopy {
  return useContext(HostCopyContext);
}
