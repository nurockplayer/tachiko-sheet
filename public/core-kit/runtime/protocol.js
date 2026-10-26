const CAPACITY_LIMIT_NAMES = [
    "collections",
    "table_fields",
    "table_rows",
    "total_entities",
    "populated_cells",
    "formulas",
    "formula_ast_nodes",
    "dependency_edges",
];
/** Validate the detailed wire payload for a capacity refusal. */
export function isCapacityFailure(failure) {
    if (failure.code !== "capacity_exceeded" ||
        !CAPACITY_LIMIT_NAMES.includes(failure.limit) ||
        !Number.isSafeInteger(failure.maximum) || failure.maximum < 0 ||
        !Number.isSafeInteger(failure.attempted) || failure.attempted <= failure.maximum) {
        return false;
    }
    if (failure.limit === "table_fields" || failure.limit === "table_rows") {
        return typeof failure.collection === "string" && failure.collection.length > 0;
    }
    return failure.collection === undefined;
}
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
