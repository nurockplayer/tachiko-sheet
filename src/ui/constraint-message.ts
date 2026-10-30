import type { ConstraintFailureProjection } from "../../public/core-kit/runtime/protocol.js";

/**
 * Words Work's structured column-rule refusal with the column's name, so the
 * person never sees internal ids. Work made the decision; this only phrases
 * it. Declaration refusals already carry Work's own wording, so they get null.
 */
export function constraintMessage(failure: unknown, columnName: (field: string) => string | undefined): string | null {
  if (!isConstraintFailure(failure) || failure.reason === "declaration") return null;
  const name = columnName(failure.field) ?? "This column";
  const constraint = failure.constraint;
  const rule = constraint.kind === "number_inclusive_range"
    ? `between ${constraint.min} and ${constraint.max}`
    : constraint.values.length <= 6 ? `one of ${listOf(constraint.values)}` : "one of its allowed values";
  if (failure.reason === "field_value") return `${name} must be ${rule}.`;
  const rows = failure.offending_rows;
  return `${rows === 1 ? "1 row" : `${rows} rows`} in ${name} ${rows === 1 ? "is" : "are"} not ${rule}. Change ${rows === 1 ? "it" : "them"} first, or choose a rule that fits.`;
}

function listOf(values: readonly string[]): string {
  return values.length < 2 ? values.join("") : `${values.slice(0, -1).join(", ")} or ${values.at(-1)}`;
}

function isConstraintFailure(value: unknown): value is ConstraintFailureProjection {
  if (typeof value !== "object" || value === null) return false;
  const failure = value as Partial<ConstraintFailureProjection>;
  const constraint = failure.constraint as { kind?: unknown; values?: unknown; min?: unknown; max?: unknown } | undefined;
  return typeof failure.field === "string" && typeof failure.offending_rows === "number" &&
    (failure.reason === "field_value" || failure.reason === "existing_values" || failure.reason === "declaration") &&
    (constraint?.kind === "number_inclusive_range" ? typeof constraint.min === "number" && typeof constraint.max === "number"
      : constraint?.kind === "text_literal_set" && Array.isArray(constraint.values) && constraint.values.every(item => typeof item === "string"));
}
