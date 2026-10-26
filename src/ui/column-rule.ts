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

/** Turns the draft into Work's request. This only parses the form; Work decides whether the rule is admissible. */
export function columnRuleInput(draft: ColumnRuleDraft): { input: FieldConstraint } | { error: string } {
  if (draft.kind === "list") {
    const values = draft.values.split("\n").map(value => value.trim()).filter(value => value.length > 0);
    return values.length > 0
      ? { input: { kind: "text_literal_set", values } }
      : { error: "Enter at least one allowed value." };
  }
  const numberPattern = /^-?\d+(\.\d+)?$/;
  const minText = draft.min.trim();
  const maxText = draft.max.trim();
  if (!numberPattern.test(minText) || !numberPattern.test(maxText)) {
    return { error: "Enter a number for both the lowest and highest value." };
  }
  return { input: { kind: "number_inclusive_range", min: Number(minText), max: Number(maxText) } };
}

export interface ColumnRuleSettlement { close: boolean; error: string | null }

/** confirmed and recovery close; refused keeps the dialog open with Work's message verbatim. */
export function columnRuleSettlement(result: RowCommandOutcome): ColumnRuleSettlement {
  if (result.kind === "refused") return { close: false, error: result.message };
  return { close: true, error: null };
}
