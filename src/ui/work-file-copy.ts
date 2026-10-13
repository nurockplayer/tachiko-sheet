/** Explain producer refusals without hiding the original Work reason. */
export function workFileOpenRefusal(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  let message = "The work file could not be opened. The current work was kept.";
  if (/unconstrained fields/i.test(detail)) {
    message = "This work file uses field restrictions that Sheet cannot open yet. The current work was kept.";
  } else if (/unsupported_payload_representation/i.test(detail)) {
    message = "This work file uses a file version that Sheet cannot open. The current work was kept.";
  } else if (/resource_limit/i.test(detail)) {
    message = "This work file exceeds the supported size or content limits. The current work was kept.";
  } else if (/portable_package\.(invalid_container|integrity_mismatch)/i.test(detail)) {
    message = "This file is damaged or is not a supported Tachiko work file. The current work was kept.";
  }
  return `${message} (Details: ${detail})`;
}
