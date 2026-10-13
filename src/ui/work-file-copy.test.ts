import { expect, it } from "vitest";
import { workFileOpenRefusal } from "./work-file-copy.js";

it.each([
  ["Designer v3 admission supports only unconstrained fields.", "field restrictions"],
  ["portable_package.unsupported_payload_representation: requires v3", "file version"],
  ["portable_package.resource_limit: limit is 67108864", "supported size or content limits"],
  ["portable_package.invalid_container: CRC mismatch", "damaged"],
  ["An unfamiliar Work refusal", "could not be opened"],
])("explains %s while retaining the producer reason", (reason, plain) => {
  const message = workFileOpenRefusal(new Error(reason));
  expect(message).toContain(plain);
  expect(message).toContain("The current work was kept.");
  expect(message).toContain(`(Details: ${reason})`);
});
