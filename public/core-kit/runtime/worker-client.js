import { projectTransferFromEntries } from "../host/project-transfer.js";
import { isCapacityFailure } from "./protocol.js";
import { DesignerRuntimeError, } from "./client.js";
export class WorkerDesignerClient {
    #worker;
    #pending = new Map();
    #nextId = 1;
    constructor(createWorker) {
        this.#worker = createWorker();
        this.#worker.addEventListener("message", (event) => {
            const pending = this.#pending.get(event.data.id);
            if (pending === undefined)
                return;
            this.#pending.delete(event.data.id);
            if (event.data.status === "error") {
                if (event.data.error.code === "capacity_exceeded" && !isCapacityFailure(event.data.error)) {
                    pending.reject(new Error("Invalid Worker capacity failure."));
                    return;
                }
                pending.reject(new DesignerRuntimeError(event.data.error));
            }
            else {
                pending.resolve(event.data);
            }
        });
        this.#worker.addEventListener("error", (event) => {
            const error = new Error(event.message || "The Designer Worker stopped unexpectedly.");
            for (const pending of this.#pending.values())
                pending.reject(error);
            this.#pending.clear();
        });
    }
    async newTracker() {
        return expectResponse("opened", await this.#command({ type: "new_tracker", occurrence_id: freshOccurrenceId() }));
    }
    async #spreadsheet(operation, bytes = new ArrayBuffer(0)) {
        const copy = bytes.slice(0);
        return this.#send({ id: this.#claimId(), kind: "spreadsheet", operation, bytes: copy }, [copy]);
    }
    async inspectSpreadsheet(bytes, format, csvOptions) {
        const reply = await this.#spreadsheet({ type: "inspect", format, csv_options: csvOptions }, bytes);
        if (reply.status !== "ok")
            throw new Error("Expected spreadsheet inspection.");
        return expectResponse("import_preview", reply.response);
    }
    async importSpreadsheet(bytes, format, csvOptions, selection, validate) {
        const occurrence_id = freshOccurrenceId();
        const operation = { type: "import", format, csv_options: csvOptions, selection, occurrence_id, install: false };
        const preview = await this.#spreadsheet(operation, bytes);
        if (preview.status !== "ok")
            throw new Error("Expected spreadsheet import preview.");
        const candidate = expectResponse("imported", preview.response);
        validate?.(candidate);
        const reply = await this.#spreadsheet({ ...operation, install: true }, bytes);
        if (reply.status !== "ok")
            throw new Error("Expected spreadsheet import.");
        return expectResponse("imported", reply.response);
    }
    async inspectImportedProject(bytes, metadata) {
        const reply = await this.#spreadsheet({ type: "inspect_project", metadata }, bytes);
        if (reply.status !== "ok")
            throw new Error("Expected imported project inspection.");
        return expectResponse("opened", reply.response);
    }
    async openImportedProject(bytes, metadata) {
        const reply = await this.#spreadsheet({ type: "open_project", occurrence_id: freshOccurrenceId(), metadata }, bytes);
        if (reply.status !== "ok")
            throw new Error("Expected imported project open.");
        return expectResponse("opened", reply.response);
    }
    async exportSpreadsheet(expectedRevision, metadata, format, collection) {
        const reply = await this.#spreadsheet({ type: "export", expected_revision: expectedRevision, metadata, format, collection });
        if (reply.status !== "spreadsheet_exported")
            throw new Error("Expected spreadsheet export.");
        return reply.export;
    }
    async exportNativeTablesSpreadsheet(expectedRevision, collection, format) {
        const reply = await this.#spreadsheet({ type: "export_native_tables", expected_revision: expectedRevision, collection, format });
        if (reply.status !== "spreadsheet_exported")
            throw new Error("Expected native tables spreadsheet export.");
        return reply.export;
    }
    async exportNativeTrackerSpreadsheet(expectedRevision, presentation, format) {
        const reply = await this.#spreadsheet({ type: "export_native_tracker", expected_revision: expectedRevision, presentation, format });
        if (reply.status !== "spreadsheet_exported")
            throw new Error("Expected native Tracker spreadsheet export.");
        return reply.export;
    }
    async exportNativeBudgetSpreadsheet(expectedRevision, presentation, format) {
        const reply = await this.#spreadsheet({ type: "export_native_budget", expected_revision: expectedRevision, presentation, format });
        if (reply.status !== "spreadsheet_exported")
            throw new Error("Expected native Budget spreadsheet export.");
        return reply.export;
    }
    async previewCleanup(expectedRevision, operation) {
        return expectResponse("cleanup_preview", await this.#command({ type: "preview_cleanup", expected_revision: expectedRevision, operation }));
    }
    async commitCleanup(expectedRevision, previewId) {
        return expectResponse("published", await this.#command({ type: "commit_cleanup", expected_revision: expectedRevision, preview_id: previewId }));
    }
    async newBudget() {
        return expectResponse("opened", await this.#command({ type: "new_budget", occurrence_id: freshOccurrenceId() }));
    }
    async newTable(name, columns) {
        return expectResponse("opened", await this.#command({ type: "new_table", occurrence_id: freshOccurrenceId(), name, columns }));
    }
    async duplicateCollection(expectedRevision, collection, name) {
        return expectResponse("duplicated", await this.#command({ type: "duplicate_collection", expected_revision: expectedRevision, collection, name }));
    }
    /** Return complete entity and schema presentation invalidation from Rust. */
    async trackerCommand(request) {
        return expectResponse("published", await this.#command(request));
    }
    async clearField(expectedRevision, target) {
        return expectResponse("published", await this.#command({ type: "edit_scalar", expected_revision: expectedRevision, target, input: { kind: "clear" } }));
    }
    async setColumnRequiredness(expectedRevision, collection, field, required) {
        return this.trackerCommand({ type: "set_column_requiredness", expected_revision: expectedRevision, collection, field, required });
    }
    async setColumnConstraint(expectedRevision, collection, field, constraint) {
        return this.trackerCommand({ type: "set_column_constraint", expected_revision: expectedRevision, collection, field, constraint });
    }
    async setColumnNumberFormat(expectedRevision, collection, field, numberFormat) {
        return this.trackerCommand({ type: "set_column_number_format", expected_revision: expectedRevision, collection, field, number_format: numberFormat });
    }
    async moveColumn(expected, collection, field, toIndex) {
        return this.trackerCommand({ type: "move_column", expected_revision: expected, collection, field, to_index: toIndex });
    }
    async bootstrap() {
        return expectResponse("bootstrap", await this.#command({
            type: "bootstrap",
            occurrence_id: freshOccurrenceId(),
        }));
    }
    async queryCapacity(expectedRevision) {
        return expectResponse("capacity", await this.#command(expectedRevision === undefined
            ? { type: "query_capacity" }
            : { type: "query_capacity", expected_revision: expectedRevision }));
    }
    async inspectProject(bytes) {
        // Inspection preserves the caller's bytes for the subsequent accepted open.
        const candidateBytes = bytes.slice(0);
        const reply = await this.#send({ id: this.#claimId(), kind: "inspect_project", bytes: candidateBytes }, [candidateBytes]);
        if (reply.status !== "ok") {
            throw new Error(`Expected project inspection response, received '${reply.status}'.`);
        }
        return expectResponse("opened", reply.response);
    }
    async openProject(bytes) {
        const reply = await this.#send({
            id: this.#claimId(),
            kind: "open_project",
            occurrence_id: freshOccurrenceId(),
            bytes,
        }, [bytes]);
        if (reply.status !== "ok") {
            throw new Error(`Expected project open response, received '${reply.status}'.`);
        }
        return expectResponse("opened", reply.response);
    }
    async openCanonicalTree(files) {
        return this.openProject(projectTransferFromEntries(files));
    }
    async openLocalDocument(bytes) {
        const reply = await this.#send({
            id: this.#claimId(),
            kind: "open_local_document",
            occurrence_id: freshOccurrenceId(),
            bytes,
        }, [bytes]);
        if (reply.status !== "ok") {
            throw new Error(`Expected local document open response, received '${reply.status}'.`);
        }
        return expectResponse("opened", reply.response);
    }
    async exportProject(expectedRevision) {
        const reply = await this.#send({
            id: this.#claimId(),
            kind: "export_project",
            expected_revision: expectedRevision,
        });
        if (reply.status !== "project_exported") {
            throw new Error(`Expected project export, received '${reply.status}'.`);
        }
        return reply.export;
    }
    async exportProjectV3(expectedRevision) {
        const reply = await this.#send({
            id: this.#claimId(),
            kind: "export_project_v3",
            expected_revision: expectedRevision,
        });
        if (reply.status !== "project_exported") {
            throw new Error(`Expected project export, received '${reply.status}'.`);
        }
        return reply.export;
    }
    async exportCanonicalTree(expectedRevision) {
        const reply = await this.#send({
            id: this.#claimId(),
            kind: "export_canonical_tree",
            expected_revision: expectedRevision,
        });
        if (reply.status !== "canonical_tree_exported") {
            throw new Error(`Expected canonical tree export, received '${reply.status}'.`);
        }
        return reply.export;
    }
    async exportPortableRo(expectedRevision) {
        const reply = await this.#send({
            id: this.#claimId(),
            kind: "export_portable_ro",
            expected_revision: expectedRevision,
        });
        if (reply.status !== "portable_ro_exported") {
            throw new Error(`Expected portable .ro export, received '${reply.status}'.`);
        }
        return reply.export;
    }
    async verifyPortableRo(bytes) {
        const copy = bytes.slice(0);
        const reply = await this.#send({ id: this.#claimId(), kind: "verify_portable_ro", bytes: copy }, [copy]);
        if (reply.status !== "ok" || reply.response.type !== "portable_ro_verified" || !reply.response.payload.accepted) {
            throw new Error(`Expected portable .ro verification, received '${reply.status}'.`);
        }
    }
    async openPortableRo(bytes) {
        const reply = await this.#send({
            id: this.#claimId(),
            kind: "open_portable_ro",
            occurrence_id: freshOccurrenceId(),
            bytes,
        }, [bytes]);
        if (reply.status !== "ok") {
            throw new Error(`Expected portable .ro open response, received '${reply.status}'.`);
        }
        return expectResponse("opened", reply.response);
    }
    async observeOccurrence() {
        const reply = await this.#send({ id: this.#claimId(), kind: "observe_occurrence" });
        if (reply.status !== "ok") {
            throw new Error(`Expected occurrence observation, received '${reply.status}'.`);
        }
        return expectResponse("occurrence_observed", reply.response);
    }
    async closeProject() {
        const reply = await this.#send({ id: this.#claimId(), kind: "close_project" });
        if (reply.status !== "closed") {
            throw new Error(`Expected project close, received '${reply.status}'.`);
        }
    }
    async queryTable(collection) {
        return expectResponse("table", await this.#command({ type: "query_table", collection }));
    }
    async queryTableWindow(expectedRevision, collection, view, start, count) {
        return expectResponse("table_window", await this.#command({
            type: "query_table_window",
            expected_revision: expectedRevision,
            collection,
            view,
            start,
            count,
        }));
    }
    async locateInView(expectedRevision, collection, view, entity) {
        return expectResponse("located_in_view", await this.#command({
            type: "locate_in_view",
            expected_revision: expectedRevision,
            collection,
            view,
            entity,
        }));
    }
    async queryFields(expectedRevision, fields) {
        return expectResponse("fields", await this.#command({
            type: "query_fields",
            expected_revision: expectedRevision,
            fields,
        }));
    }
    async explainField(expectedRevision, target) {
        return expectResponse("field_explanation", await this.#command({
            type: "explain_field",
            expected_revision: expectedRevision,
            target,
        }));
    }
    async createKeyedGroupedSum(expectedRevision, definition) {
        return expectResponse("keyed_grouped_sum_published", await this.#command({ type: "create_keyed_grouped_sum", expected_revision: expectedRevision, definition }));
    }
    async queryKeyedGroupedSum(definitionId) {
        return expectResponse("keyed_grouped_sum", await this.#command({ type: "query_keyed_grouped_sum", definition_id: definitionId }));
    }
    async editNumber(expectedRevision, target, input) {
        return expectResponse("published", await this.#command({
            type: "edit_scalar",
            expected_revision: expectedRevision,
            target,
            input: { kind: "number", input },
        }));
    }
    async editText(expectedRevision, target, value) {
        return expectResponse("published", await this.#command({
            type: "edit_scalar",
            expected_revision: expectedRevision,
            target,
            input: { kind: "text", value },
        }));
    }
    async editBoolean(expectedRevision, target, value) {
        return expectResponse("published", await this.#command({
            type: "edit_scalar",
            expected_revision: expectedRevision,
            target,
            input: { kind: "boolean", value },
        }));
    }
    async editDate(expectedRevision, target, value) {
        return expectResponse("published", await this.#command({
            type: "edit_scalar",
            expected_revision: expectedRevision,
            target,
            input: { kind: "date", value },
        }));
    }
    async copyFormula(expectedRevision, request) {
        return expectResponse("published", await this.#command({ ...request, type: "copy_formula", expected_revision: expectedRevision }));
    }
    async updateFormula(expectedRevision, target, source) {
        return expectResponse("published", await this.#command({ type: "formula_update", expected_revision: expectedRevision, target, source }));
    }
    close() {
        this.#worker.terminate();
        const error = new Error("The Designer runtime was closed.");
        for (const pending of this.#pending.values())
            pending.reject(error);
        this.#pending.clear();
    }
    async #command(request) {
        const reply = await this.#send({ id: this.#claimId(), kind: "command", request });
        if (reply.status !== "ok") {
            throw new Error(`Expected command response, received '${reply.status}'.`);
        }
        return reply.response;
    }
    #claimId() {
        const id = this.#nextId;
        this.#nextId += 1;
        return id;
    }
    #send(message, transfer = []) {
        return new Promise((resolve, reject) => {
            this.#pending.set(message.id, { resolve, reject });
            this.#worker.postMessage(message, transfer);
        });
    }
}
export function freshOccurrenceId() {
    if (typeof crypto.randomUUID === "function")
        return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function expectResponse(type, response) {
    if (response.type !== type) {
        throw new Error(`Expected '${type}' response, received '${response.type}'.`);
    }
    // Validate the additive optional-field metadata without normalizing the
    // sparse Rust payload (or fabricating empty Text for absent slots).
    switch (response.type) {
        case "table":
            validateTablePresence(response.payload);
            break;
        case "table_window":
            validateTablePresence(response.payload);
            break;
        case "located_in_view":
            validateLocatedInView(response.payload);
            break;
        case "opened":
            validateTablePresence(response.payload.table);
            break;
        case "imported":
            validateTablePresence(response.payload.opened.table);
            break;
        case "fields":
            response.payload.fields.forEach(validateFieldPresence);
            break;
        case "field_explanation":
            validateFieldPresence(response.payload.value);
            response.payload.direct_dependencies.forEach(dependency => validateFieldPresence(dependency.value));
            break;
        case "cleanup_preview":
            response.payload.changes.forEach(change => { if (change.before !== null)
                validateFieldPresence(change.before); });
            break;
        case "capacity":
            validateCapacity(response.payload);
            break;
    }
    return "payload" in response ? response.payload : undefined;
}
const CAPACITY_LIMITS = [
    "collections", "table_fields", "table_rows", "total_entities", "populated_cells",
    "formulas", "formula_ast_nodes", "dependency_edges",
];
function validateCapacity(capacity) {
    const nonnegativeInteger = (value) => Number.isSafeInteger(value) && value >= 0;
    if (capacity === null || typeof capacity !== "object" ||
        typeof capacity.revision !== "string" ||
        capacity.usage === null || typeof capacity.usage !== "object" ||
        capacity.limits === null || typeof capacity.limits !== "object") {
        throw new Error("Invalid Worker capacity projection.");
    }
    const usage = capacity.usage;
    const limits = capacity.limits;
    const usageCounts = [usage.collections, usage.total_entities, usage.populated_cells, usage.formulas,
        usage.formula_ast_nodes, usage.dependency_edges];
    if (!usageCounts.every(nonnegativeInteger) || !CAPACITY_LIMITS.every(limit => nonnegativeInteger(limits[limit])) ||
        usage.tables === null || typeof usage.tables !== "object" || Array.isArray(usage.tables)) {
        throw new Error("Invalid Worker capacity projection.");
    }
    for (const table of Object.values(usage.tables)) {
        if (table === null || typeof table !== "object" ||
            !nonnegativeInteger(table.rows) || !nonnegativeInteger(table.fields)) {
            throw new Error("Invalid Worker capacity projection.");
        }
    }
}
function validateFieldPresence(field) {
    if (field.blank !== undefined && typeof field.blank !== "boolean") {
        throw new Error("Invalid Worker field blank flag.");
    }
    if (field.blank === true && (field.stored !== null || field.formula !== null || field.calculated !== null)) {
        throw new Error("Invalid Worker blank field payload.");
    }
    // Presence is the stored literal/reference or formula definition, independent
    // of whether calculation succeeded. Absence must be explicit blank:true.
    if (field.blank !== true && field.stored == null && field.formula == null) {
        throw new Error("Invalid Worker non-blank field payload.");
    }
}
const byteOrder = new TextEncoder();
function compareBytes(left, right) {
    const length = Math.min(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
        if (left[index] !== right[index])
            return left[index] < right[index] ? -1 : 1;
    }
    return Math.sign(left.length - right.length);
}
/** Mirrors the semantic declaration: unique literals in strict byte order. */
function strictlyByteOrdered(values) {
    let previous;
    for (const value of values) {
        const bytes = byteOrder.encode(value);
        if (previous !== undefined && compareBytes(previous, bytes) >= 0)
            return false;
        previous = bytes;
    }
    return true;
}
function validateColumnConstraint(column) {
    const constraint = column.constraint;
    if (constraint === undefined)
        return;
    if (constraint.kind === "text_literal_set") {
        if (column.field_type !== "text" ||
            !Array.isArray(constraint.values) || constraint.values.length === 0 ||
            !constraint.values.every(value => typeof value === "string") ||
            !strictlyByteOrdered(constraint.values) ||
            !Array.isArray(column.dropdown_options) ||
            column.dropdown_options.length !== constraint.values.length ||
            column.dropdown_options.some((value, index) => value !== constraint.values[index])) {
            throw new Error("Invalid Worker column constraint.");
        }
        return;
    }
    if (constraint.kind === "number_inclusive_range") {
        if (column.field_type !== "number" ||
            !Number.isFinite(constraint.min) || !Number.isFinite(constraint.max) ||
            constraint.min > constraint.max) {
            throw new Error("Invalid Worker column constraint.");
        }
        return;
    }
    throw new Error("Invalid Worker column constraint.");
}
function validateColumnNumberFormat(column) {
    const format = column.number_format;
    if (format === undefined)
        return;
    if (format === null || typeof format !== "object") {
        throw new Error("Invalid Worker column number format.");
    }
    const kind = format.kind;
    // Mirror Rust's closed wire: exact member sets on the format and each kind.
    const exactKeys = (value, keys) => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
    const validKind = kind !== null && typeof kind === "object" && (((kind.type === "plain" || kind.type === "percent") && exactKeys(kind, ["type"])) ||
        (kind.type === "currency" && exactKeys(kind, ["type", "code"]) &&
            typeof kind.code === "string" && /^[A-Z]{3}$/.test(kind.code)));
    if (column.field_type !== "number" || !exactKeys(format, ["decimals", "kind", "thousands_separator"]) ||
        !Number.isInteger(format.decimals) ||
        format.decimals < 0 || format.decimals > 10 || typeof format.thousands_separator !== "boolean" || !validKind) {
        throw new Error("Invalid Worker column number format.");
    }
}
function validateLocatedInView(located) {
    if (located.result === "found") {
        if (!Number.isInteger(located.index) || located.index < 0) {
            throw new Error("Invalid Worker located-in-view position.");
        }
        return;
    }
    if (located.result !== "filtered_out" || located.index !== undefined) {
        throw new Error("Invalid Worker located-in-view result.");
    }
}
function validateTablePresence(table) {
    const columns = new Map(table.columns.map((column, index) => {
        if (typeof column.required !== "boolean")
            throw new Error("Invalid Worker column requiredness.");
        if (column.display_name_explicit !== undefined && column.display_name_explicit !== true) {
            throw new Error("Invalid Worker column display_name_explicit.");
        }
        validateColumnConstraint(column);
        validateColumnNumberFormat(column);
        return [column.id, { required: column.required, index }];
    }));
    if (columns.size !== table.columns.length)
        throw new Error("Invalid Worker duplicate column identity.");
    for (const row of table.rows) {
        if (row.blank_fields !== undefined && (!Array.isArray(row.blank_fields) ||
            !row.blank_fields.every(field => typeof field === "string"))) {
            throw new Error("Invalid Worker row blank_fields.");
        }
        // Every Rust table producer partitions all declared columns into present
        // fields and absent IDs, including capacity tables and opened/imported tables.
        const covered = new Set();
        let lastBlankIndex = -1;
        for (const id of row.blank_fields ?? []) {
            const column = columns.get(id);
            if (column === undefined || column.required || column.index <= lastBlankIndex) {
                throw new Error("Invalid Worker sparse row presence.");
            }
            covered.add(id);
            lastBlankIndex = column.index;
        }
        for (const field of row.fields) {
            validateFieldPresence(field);
            const id = field.target.field;
            if (field.blank === true || field.target.entity !== row.id || !columns.has(id) || covered.has(id)) {
                throw new Error("Invalid Worker sparse row presence.");
            }
            covered.add(id);
        }
        if (covered.size !== columns.size) {
            throw new Error("Invalid Worker sparse row presence.");
        }
    }
}
