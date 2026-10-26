const FORMULA_FAILURE_CODES = [
    "formula_syntax",
    "formula_unknown_reference",
    "formula_type_mismatch",
    "formula_cycle",
];
export function isFormulaFailure(failure) {
    return FORMULA_FAILURE_CODES.includes(failure.code);
}
export const fieldTargetKey = (target) => JSON.stringify([target.entity, target.field]);
