export class DesignerRuntimeError extends Error {
    failure;
    constructor(failure) {
        super(failure.message);
        this.name = "DesignerRuntimeError";
        this.failure = failure;
    }
}
