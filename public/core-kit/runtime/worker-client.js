import { projectTransferFromEntries } from "../host/project-transfer.js";
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
    async exportSpreadsheet(expectedRevision, metadata, format, collection) {
        const reply = await this.#spreadsheet({ type: "export", expected_revision: expectedRevision, metadata, format, collection });
        if (reply.status !== "spreadsheet_exported")
            throw new Error("Expected spreadsheet export.");
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
    async trackerCommand(request) {
        return expectResponse("published", await this.#command(request));
    }
    async bootstrap() {
        return expectResponse("bootstrap", await this.#command({
            type: "bootstrap",
            occurrence_id: freshOccurrenceId(),
        }));
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
    async queryFields(expectedRevision, fields) {
        return expectResponse("fields", await this.#command({
            type: "query_fields",
            expected_revision: expectedRevision,
            fields,
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
    return "payload" in response ? response.payload : undefined;
}
