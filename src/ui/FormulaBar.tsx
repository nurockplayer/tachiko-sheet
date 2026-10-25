import { useId, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import { FORMULA_BAR_PLACEHOLDER, formulaBarDraftValue, formulaRefusalText, type FormulaBarDraft, type FormulaBarState } from "./formula-bar.js";

export interface FormulaBarProps {
  /** Exactly one focused cell instance, or an empty state with its reason. */
  state: FormulaBarState;
  /** A draft bound to this exact revision and cell; anything older is ignored. */
  draft: FormulaBarDraft | null;
  /** A commit is in flight; never accept another submission. */
  pending: boolean;
  /** Work's refusal message, shown verbatim below the bar. */
  error: { message: string; position?: number } | null;
  onChange?(value: string): void;
  onKeyDown?(event: ReactKeyboardEvent<HTMLInputElement>): void;
  inputRef?(node: HTMLInputElement | null): void;
}

/** Dense spreadsheet chrome: `fx`, the focused cell name, then the source. */
export function FormulaBar(props: FormulaBarProps) {
  const id = useId();
  const reasonId = `${id}-reason`;
  const errorId = `${id}-error`;
  const detailsId = `${id}-details`;
  const state = props.state;
  const value = formulaBarDraftValue(state, props.draft);
  // A refusal keeps to the fixed 18px line, so a long message is cut off with
  // an ellipsis. `title` and the Details disclosure expose the whole text
  // without adding a line that would move the grid. The open disclosure is
  // keyed by the text, so a different refusal never inherits it.
  const errorText = props.error ? formulaRefusalText(props.error) : "";
  const [openErrorText, setOpenErrorText] = useState<string | null>(null);
  const detailsOpen = props.error !== null && openErrorText === errorText;
  return (
    <div className={`ts-formula-bar${state.editable ? "" : " ts-formula-bar--readonly"}`} data-testid="formula-bar">
      <div className="ts-formula-bar-row">
        <span className="ts-formula-fx" aria-hidden="true">fx</span>
        <span className="ts-formula-cell" data-testid="formula-bar-cell">{state.label}</span>
        <input
          ref={props.inputRef}
          className="ts-formula-input"
          type="text"
          aria-label={state.label ? `Formula for ${state.label}` : "Formula"}
          aria-describedby={[state.reason || state.note ? reasonId : null, props.error ? errorId : null].filter(Boolean).join(" ") || undefined}
          placeholder={FORMULA_BAR_PLACEHOLDER}
          value={value}
          readOnly={!state.editable}
          disabled={props.pending}
          autoComplete="off"
          spellCheck={false}
          data-testid="formula-bar-input"
          onChange={props.onChange ? (event) => props.onChange!(event.currentTarget.value) : undefined}
          onKeyDown={props.onKeyDown}
        />
      </div>
      {/* The reason line is always present, even when empty: the bar sits in
          normal flow above the grid, and a line that appeared or disappeared
          with focus moved every row under the pointer between the two clicks
          of a double-click. One reserved line keeps the grid still. A refusal
          shares that line instead of adding one, so the bar keeps its height
          while the message is shown and the grid never moves. */}
      <div className="ts-formula-bar-notes">
        <p className="ts-hint ts-formula-bar-reason" id={reasonId} data-testid="formula-bar-reason">
          {state.reason ?? state.note ?? ""}
        </p>
        {props.error ? (
          <>
            <p className="ts-dialog-error ts-row-error ts-formula-bar-error" id={errorId} role="alert" aria-live="assertive" aria-atomic="true" title={errorText}>
              {props.error.message}
              {props.error.position !== undefined
                ? <span className="ts-formula-bar-position"> (position {props.error.position})</span>
                : null}
            </p>
            <button
              type="button"
              className="ts-formula-bar-details"
              aria-expanded={detailsOpen}
              aria-controls={detailsId}
              onClick={() => setOpenErrorText(detailsOpen ? null : errorText)}
            >Details</button>
            <div className="ts-formula-bar-error-details" id={detailsId} hidden={!detailsOpen}>{errorText}</div>
          </>
        ) : null}
      </div>
    </div>
  );
}
