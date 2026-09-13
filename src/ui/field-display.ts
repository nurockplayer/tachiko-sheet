import type { FieldProjection } from "../../public/core-kit/experimental-client.js";
import type { ScalarEdit } from "../contracts.js";

/** Visual tone of a rendered fact. Never a semantic judgement about the value. */
export type FieldTone = "plain" | "computed" | "warning" | "muted" | "reference";

export interface FieldDisplay {
  /** Exactly the text rendered for the fact. */
  text: string;
  tone: FieldTone;
  /** Extra explanation for a tooltip, never part of the fact text. */
  title: string | null;
}

export const NOT_LOADED_TEXT = "Not loaded";
export const EMPTY_TEXT = "Empty";
export const UNAVAILABLE_TEXT = "Unavailable";
export const CALCULATION_FAILED_TEXT = "Calculation failed";
export const REFERENCE_TEXT = "→ reference";

const NOT_LOADED: FieldDisplay = {
  text: NOT_LOADED_TEXT,
  tone: "muted",
  title: "This field has not been read from the open work.",
};

/**
 * Renders one public FieldProjection without deriving meaning: stored values,
 * core-calculated results, explicit failure/unavailable states and missing
 * projections each stay distinguishable.
 */
export function fieldDisplay(field: FieldProjection | null | undefined): FieldDisplay {
  if (!field) return NOT_LOADED;
  const base = baseDisplay(field);
  const diagnostic = field.diagnostics?.[0];
  if (diagnostic) {
    const canonicalText = !field.formula && field.stored?.kind === "text" ? field.stored.value : null;
    return {
      ...base,
      tone: "warning",
      title:
        canonicalText === null
          ? `${diagnostic.code}: ${diagnostic.message}`
          : `${diagnostic.code}: ${diagnostic.message} — ${canonicalText}`,
    };
  }
  return base;
}

function baseDisplay(field: FieldProjection): FieldDisplay {
  const calculated = field.calculated;
  if (calculated) {
    if (calculated.status === "value") {
      return {
        text: formatNumber(calculated.value),
        tone: field.formula ? "computed" : "plain",
        title: field.formula ? "Calculated value" : null,
      };
    }
    if (calculated.status === "failure") {
      return {
        text: CALCULATION_FAILED_TEXT,
        tone: "warning",
        title: `${calculated.code}: ${calculated.message}`,
      };
    }
    return {
      text: UNAVAILABLE_TEXT,
      tone: "muted",
      title: "The core reports this calculation as unavailable.",
    };
  }
  return storedDisplay(field);
}

function storedDisplay(field: FieldProjection): FieldDisplay {
  const stored = field.stored;
  if (!stored) {
    return {
      text: EMPTY_TEXT,
      tone: "muted",
      title: field.formula
        ? "Calculated value without a current result"
        : "The open work reports no value for this field.",
    };
  }
  switch (stored.kind) {
    case "number":
      if (!Number.isFinite(stored.value)) {
        return { text: UNAVAILABLE_TEXT, tone: "muted", title: "The stored number is not finite." };
      }
      return {
        text: formatNumber(stored.value),
        tone: field.formula ? "computed" : "plain",
        title: formulaTitle(field),
      };
    case "text":
      return stored.value === ""
        ? { text: EMPTY_TEXT, tone: "muted", title: "The stored text is empty." }
        : {
            text: stored.value,
            tone: field.formula ? "computed" : "plain",
            title: field.formula ? "Calculated value" : stored.value,
          };
    case "boolean":
      return {
        text: stored.value ? "true" : "false",
        tone: field.formula ? "computed" : "plain",
        title: formulaTitle(field),
      };
    case "date":
      return { text: stored.value, tone: field.formula ? "computed" : "plain", title: formulaTitle(field) };
    case "reference":
      return {
        text: REFERENCE_TEXT,
        tone: "reference",
        title: "Reference value",
      };
    default:
      return NOT_LOADED;
  }
}

function formulaTitle(field: FieldProjection): string | null {
  return field.formula ? "Calculated value" : null;
}

function formatNumber(value: number): string {
  return String(value);
}

/** Text seeded into a cell editor from the actual projection. */
export function seedTextOf(field: FieldProjection): string {
  const stored = field.stored;
  if (stored) {
    switch (stored.kind) {
      case "number":
        return String(stored.value);
      case "text":
        return stored.value;
      case "boolean":
        return stored.value ? "true" : "false";
      case "date":
        return stored.value;
      case "reference":
        return stored.entity;
    }
  }
  if (field.calculated?.status === "value") return formatNumber(field.calculated.value);
  return "";
}

/**
 * Builds the typed edit intent for one scalar draft. Numbers cross as raw input;
 * the UI performs no numeric validation or coercion.
 */
export function scalarEditOf(kind: "number" | "text" | "date", raw: string): ScalarEdit {
  switch (kind) {
    case "number":
      return { kind: "number", input: raw };
    case "date":
      return { kind: "date", value: raw };
    case "text":
      return { kind: "text", value: raw };
  }
}

/** Parses a boolean draft; returns null when the draft cannot be a boolean value. */
export function parseBooleanDraft(raw: string): boolean | null {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return null;
}
