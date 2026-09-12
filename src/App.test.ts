import { describe, expect, it } from "vitest";

import { recoveryDraftAfterBoundary } from "./App.js";

describe("recovery draft lifecycle", () => {
  it("retains the draft only across its own authoritative reobserve", () => {
    expect(recoveryDraftAfterBoundary('{"kind":"number","input":"3"}', "reobserve")).toBe(
      '{"kind":"number","input":"3"}',
    );
    expect(recoveryDraftAfterBoundary('{"kind":"number","input":"3"}', "replacement")).toBe(null);
    expect(recoveryDraftAfterBoundary('{"kind":"number","input":"3"}', "close")).toBe(null);
  });
});
