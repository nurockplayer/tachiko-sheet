import type { FieldConstraint, FieldConstraintInput } from "../../public/core-kit/runtime/protocol.js";
import type { RowCommandOutcome } from "../contracts.js";

export type ColumnRuleKind = "list" | "range";

/** Text columns take an allowed-values list; number columns an inclusive range; others have no rule. */
export function columnRuleKind(fieldType: string): ColumnRuleKind | null {
  if (fieldType === "text") return "list";
  if (fieldType === "number") return "range";
  return null;
}

export interface ColumnRuleDraft { kind: ColumnRuleKind; values: string; min: string; max: string }

/** Prefill from Work's declared constraint: list values one per line; range bounds as String(n). */
export function columnRuleDraft(column: { field_type: string; constraint?: FieldConstraint }): ColumnRuleDraft | null {
  const kind = columnRuleKind(column.field_type);
  if (kind === null) return null;
  const constraint = column.constraint;
  if (kind === "list") {
    return {
      kind,
      values: constraint?.kind === "text_literal_set" ? constraint.values.join("\n") : "",
      min: "",
      max: "",
    };
  }
  return {
    kind,
    values: "",
    min: constraint?.kind === "number_inclusive_range" ? String(constraint.min) : "",
    max: constraint?.kind === "number_inclusive_range" ? String(constraint.max) : "",
  };
}

/**
 * Turns the draft into Work's request. This only parses the form; Work decides
 * whether the rule is admissible (duplicates, limits, min > max, existing rows).
 * List values are sent exactly as typed, one per line; only empty lines are
 * dropped (a line of spaces is a value, and Work decides whether to admit it).
 */
export function columnRuleInput(draft: ColumnRuleDraft): { input: FieldConstraint } | { error: string } {
  if (draft.kind === "list") {
    const typed = draft.values.split(/\r?\n/).filter(value => value.length > 0);
    if (typed.length === 0) return { error: "Enter at least one allowed value." };
    // Work stores a set as unique values in UTF-8 byte order and refuses any
    // other order, so send that order; the values themselves stay literal.
    const values = [...typed].sort(compareUtf8);
    if (values.some((value, index) => index > 0 && value === values[index - 1])) {
      return { error: "Each allowed value can appear only once." };
    }
    return { input: { kind: "text_literal_set", values } };
  }
  const bound = (text: string) => text.trim() === "" ? Number.NaN : Number(text.trim());
  const min = bound(draft.min);
  const max = bound(draft.max);
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { error: "Enter a number for both the lowest and highest value." };
  }
  return { input: { kind: "number_inclusive_range", min, max } };
}

export interface ColumnRuleSettlement { close: boolean; error: string | null; confirmed: boolean }

/** confirmed and recovery close; refused keeps the dialog open with Work's message verbatim. */
export function columnRuleSettlement(result: RowCommandOutcome): ColumnRuleSettlement {
  if (result.kind === "refused") return { close: false, error: result.message, confirmed: false };
  // A recovery closes the dialog, but its outcome is unknown: never announce it as applied.
  return { close: true, error: null, confirmed: result.kind === "confirmed" };
}

const utf8 = new TextEncoder();
function compareUtf8(left: string, right: string): number {
  const a = utf8.encode(left), b = utf8.encode(right);
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    if (a[index] !== b[index]) return a[index]! - b[index]!;
  }
  return a.length - b.length;
}
