import { describe, expect, it } from "vitest";
import { columnSavePreflightDecision, duplicateSavePreflightDecision, COLUMN_SAVE_STALE, COLUMN_SAVE_UNAVAILABLE, DUPLICATE_SAVE_STALE, DUPLICATE_SAVE_UNAVAILABLE } from "./column-save-preflight.js";

describe("column portable-save preflight admission", () => {
  const witness = { occurrence: "o1", revision: "r1" };
  it("admits only the exported current occurrence/revision", () => {
    expect(columnSavePreflightDecision(witness, witness, "r1")).toEqual({ allowed: true });
  });
  it("refuses every missing export result without inferring a row-count or type limit", () => {
    expect(columnSavePreflightDecision(witness, witness, null)).toEqual({ allowed: false, message: COLUMN_SAVE_UNAVAILABLE });
    expect(columnSavePreflightDecision(witness, null, null)).toEqual({ allowed: false, message: COLUMN_SAVE_UNAVAILABLE });
  });
  it("refuses stale or replaced evidence before mutation dispatch", () => {
    for (const current of [null, { ...witness, occurrence: "o2" }, { ...witness, revision: "r2" }]) {
      expect(columnSavePreflightDecision(witness, current, "r1")).toEqual({ allowed: false, message: COLUMN_SAVE_STALE });
    }
    expect(columnSavePreflightDecision(witness, witness, "r2")).toEqual({ allowed: false, message: COLUMN_SAVE_STALE });
  });
});

describe("table duplicate portable-save preflight admission", () => {
  const witness = { occurrence: "o1", revision: "r1" };
  it("admits only the exported current occurrence/revision", () => {
    expect(duplicateSavePreflightDecision(witness, witness, "r1")).toEqual({ allowed: true });
  });
  it("refuses a work whose portable export could not be produced", () => {
    expect(duplicateSavePreflightDecision(witness, witness, null)).toEqual({ allowed: false, message: DUPLICATE_SAVE_UNAVAILABLE });
  });
  it("refuses stale or replaced evidence before dispatching the duplicate", () => {
    for (const current of [null, { ...witness, occurrence: "o2" }, { ...witness, revision: "r2" }]) {
      expect(duplicateSavePreflightDecision(witness, current, "r1")).toEqual({ allowed: false, message: DUPLICATE_SAVE_STALE });
    }
    expect(duplicateSavePreflightDecision(witness, witness, "r2")).toEqual({ allowed: false, message: DUPLICATE_SAVE_STALE });
  });
});
