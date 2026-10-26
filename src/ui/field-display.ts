import type { FieldProjection } from "../../public/core-kit/experimental-client.js";
import type { ScalarValueEdit } from "../contracts.js";
import type { NumberFormat } from "../../public/core-kit/runtime/protocol.js";
import { fieldForColumn, type TableColumn, type TableRow } from "./projection-access.js";

/** Visual tone of a rendered fact. Never a semantic judgement about the value. */
export type FieldTone = "plain" | "computed" | "warning" | "muted" | "reference";

export interface FieldDisplay {
  /** Exactly the text rendered for the fact. */
  text: string;
  tone: FieldTone;
  /** Extra explanation for a tooltip, never part of the fact text. */
  title: string | null;
  description?: "Blank" | "Empty text";
  emptyTextMarker?: boolean;
}

export const EMPTY_TEXT = "Empty";
export const UNAVAILABLE_TEXT = "Unavailable";
export const CALCULATION_FAILED_TEXT = "Calculation failed";
export const REFERENCE_TEXT = "→ reference";

// A missing projection is not evidence of a canonical blank.
const NOT_LOADED: FieldDisplay = {
  text: "",
  tone: "muted",
  title: "No value",
};

/**
 * Renders one public FieldProjection without deriving meaning: stored values,
 * core-calculated results, explicit failure/unavailable states and missing
 * projections each stay distinguishable.
 */
export function fieldDisplay(field: FieldProjection | null | undefined, required = true, format?: NumberFormat): FieldDisplay {
  if (!field) return NOT_LOADED;
  if (field.blank === true) return BLANK_DISPLAY;
  const base = baseDisplay(field, format);
  if (!field.formula && !field.calculated && field.stored?.kind === "text" && field.stored.value === "") {
    base.description = "Empty text";
    if (!required) { base.text = '""'; base.emptyTextMarker = true; }
  }
  const diagnostic = field.diagnostics?.[0];
  if (diagnostic) {
    const canonicalText = !field.formula && field.stored?.kind === "text" ? field.stored.value : null;
    return {
      ...base,
      // A blank cell would hide the warning; keep a visible marker.
      text: base.text === "" ? EMPTY_TEXT : base.text,
      tone: "warning",
      title:
        canonicalText === null
          ? `${diagnostic.code}: ${diagnostic.message}`
          : `${diagnostic.code}: ${diagnostic.message} — ${canonicalText}`,
    };
  }
  return base;
}

const BLANK_DISPLAY: FieldDisplay = { text: "", tone: "muted", title: "Blank", description: "Blank" };

/** Sparse table fields are joined by ID; only producer presence metadata marks a blank. */
export function cellDisplay(row: TableRow, column: TableColumn): FieldDisplay {
  if (row.blank_fields?.includes(column.id)) return BLANK_DISPLAY;
  return fieldDisplay(fieldForColumn(row, column.id), column.required, column.number_format);
}

/** Copy authoritative values, independently of display markers, tooltips or warnings. */
export function fieldClipboardText(field: FieldProjection | null | undefined): string {
  if (!field || field.blank === true) return "";
  if (field.calculated) return field.calculated.status === "value" ? formatNumber(field.calculated.value) : "";
  return seedTextOf(field);
}

function baseDisplay(field: FieldProjection, format?: NumberFormat): FieldDisplay {
  const calculated = field.calculated;
  if (calculated) {
    if (calculated.status === "value") {
      return {
        text: formatNumberFor(calculated.value, format),
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
      title: "This calculation has no available result.",
    };
  }
  return storedDisplay(field, format);
}

function storedDisplay(field: FieldProjection, format?: NumberFormat): FieldDisplay {
  const stored = field.stored;
  if (!stored) {
    return field.formula
      ? { text: EMPTY_TEXT, tone: "muted", title: "Calculated value without a current result" }
      : { text: "", tone: "muted", title: "No value" };
  }
  switch (stored.kind) {
    case "number":
      if (!Number.isFinite(stored.value)) {
        return { text: UNAVAILABLE_TEXT, tone: "muted", title: "The stored number is not finite." };
      }
      return {
        text: formatNumberFor(stored.value, format),
        tone: field.formula ? "computed" : "plain",
        title: formulaTitle(field),
      };
    case "text":
      return stored.value === ""
        ? { text: "", tone: "muted", title: "Empty text" }
        : {
            text: stored.value,
            tone: field.formula ? "computed" : "plain",
            title: field.formula ? "Calculated value" : stored.value,
          };
    case "boolean":
      return {
        text: booleanText(stored.value),
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

const numberFormatterCache = new Map<string, Intl.NumberFormat>();

export function formatNumberFor(value: number, format: NumberFormat | undefined): string {
  if (!format) return String(value);
  const key = JSON.stringify(format);
  let formatter = numberFormatterCache.get(key);
  if (!formatter) {
    try {
      formatter = new Intl.NumberFormat("en-US", {
        minimumFractionDigits: format.decimals,
        maximumFractionDigits: format.decimals,
        useGrouping: format.thousands_separator,
        style: format.kind.type === "currency" ? "currency" : format.kind.type === "percent" ? "percent" : "decimal",
        ...(format.kind.type === "currency" ? { currency: format.kind.code } : {}),
      });
    } catch {
      return String(value);
    }
    numberFormatterCache.set(key, formatter);
  }
  return formatter.format(value);
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
        return booleanText(stored.value);
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
export function scalarEditOf(kind: "number" | "text" | "date", raw: string): ScalarValueEdit {
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

/** Shared spelling for boolean facts and the draft preview. */
export function booleanText(value: boolean): string {
  return value ? "true" : "false";
}
