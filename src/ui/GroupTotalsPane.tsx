/**
 * The "Totals by a column" panel: Work's grouped reply, shown beside the grid.
 * Every decision — which columns group, which rows are covered — belongs to
 * the shell; this component only renders the chosen question and its answer.
 */
import { useState, type ClipboardEvent as ReactClipboardEvent } from "react";
import type { ColumnProjection } from "../../public/core-kit/runtime/protocol.js";
import type { GroupTotalsOutcome } from "../runtime/session.js";
import { formatNumberFor } from "./field-display.js";
import {
  canThenBySameDate,
  withDimensionBucket,
  groupDimensionHeader,
  groupKeyLabel,
  groupKeyMarker,
  groupRefusalMessage,
  groupTotalsTsv,
  groupableColumns,
  measureColumns,
  type GroupSetup,
} from "./group-totals.js";

export type GroupTotalsScopeChoice = "shown" | "all";

export interface GroupTotalsPaneProps {
  columns: ColumnProjection[];
  setup: GroupSetup;
  /** The most recent reply; null before the first one arrives. */
  outcome: GroupTotalsOutcome | null;
  pending: boolean;
  /** True while the grid filter hides rows, so the Rows control applies. */
  filterHidesRows: boolean;
  shownRows: number;
  totalRows: number;
  /** False when the shown-rows request would exceed Work's wire limit. */
  shownScopeAvailable: boolean;
  scopeChoice: GroupTotalsScopeChoice;
  onChange(setup: GroupSetup): void;
  onScopeChange(choice: GroupTotalsScopeChoice): void;
  onClose(): void;
}

export function GroupTotalsPane(props: GroupTotalsPaneProps) {
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const first = props.columns.find((column) => column.id === props.setup.dimension) ?? null;
  const headingName = first?.display_name ?? props.setup.dimension;
  const groupable = groupableColumns(props.columns);
  const measures = measureColumns(props.columns);
  const then = props.setup.then === null ? null : props.columns.find((column) => column.id === props.setup.then) ?? null;
  const outcome = props.outcome;
  const projection = outcome?.kind === "result" ? outcome.projection : null;
  const refusal = outcome?.kind === "refused" ? groupRefusalMessage(outcome.code, outcome.message) : null;
  const tsv = projection ? groupTotalsTsv(projection, props.columns) : null;
  const measureColumnsOfReply = projection
    ? projection.measures.map((id) => props.columns.find((column) => column.id === id))
    : [];
  const dimensionColumnsOfReply = projection
    ? projection.dimensions.map((dimension) => props.columns.find((column) => column.id === dimension.field) ?? { display_name: dimension.field, field_type: "unknown" })
    : [];

  function changeDimension(id: string): void {
    const column = props.columns.find((candidate) => candidate.id === id);
    if (!column) return;
    props.onChange({
      ...props.setup,
      dimension: id,
      bucket: column.field_type === "date" ? "month" : props.setup.bucket,
      then: props.setup.then === id ? null : props.setup.then,
    });
  }

  function changeThen(value: string): void {
    if (value === "") {
      props.onChange({ ...props.setup, then: null, thenBucket: "month" });
      return;
    }
    const column = props.columns.find((candidate) => candidate.id === value);
    if (!column) return;
    props.onChange({ ...props.setup, then: value, thenBucket: "month" });
  }

  function toggleMeasure(id: string): void {
    const next = props.setup.measures.includes(id)
      ? props.setup.measures.filter((measure) => measure !== id)
      : [...props.setup.measures, id];
    if (next.length < 1 || next.length > 4) return;
    props.onChange({ ...props.setup, measures: next });
  }

  function copyTable(event: ReactClipboardEvent<HTMLTableElement>): void {
    if (!tsv || !event.clipboardData) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", tsv);
  }

  function copy(): void {
    if (!tsv || !projection) return;
    const onCopy = (event: ClipboardEvent): void => {
      event.preventDefault();
      event.clipboardData?.setData("text/plain", tsv);
    };
    // Same one-shot handshake as the grid: the command only reaches our text.
    document.addEventListener("copy", onCopy, { once: true });
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    }
    document.removeEventListener("copy", onCopy);
    setCopyStatus(copied ? `Copied ${projection.groups.length} groups.` : "Select the table and press ⌘C to copy.");
  }

  return (
    <section className="ts-results-pane ts-group-totals" role="region" aria-label="Totals by a column" data-testid="group-totals">
      <div className="ts-results-heading">
        <div><h2 className="ts-content-heading">Totals by {headingName}</h2></div>
        <button type="button" className="ts-button ts-button--ghost ts-group-totals-close" aria-label="Close totals" onClick={props.onClose}>×</button>
      </div>
      <div className="ts-group-totals-controls">
        <label className="ts-group-totals-field">
          <span>Group by</span>
          <select aria-label="Group by" value={props.setup.dimension} onChange={(event) => changeDimension(event.currentTarget.value)}>
            {groupable.map((column) => <option key={column.id} value={column.id}>{column.display_name}</option>)}
          </select>
        </label>
        {first?.field_type === "date" ? <label className="ts-group-totals-field">
          <span>Date</span>
          <select aria-label="Date" value={props.setup.bucket} onChange={(event) => props.onChange(withDimensionBucket(props.setup, first, event.currentTarget.value as GroupSetup["bucket"]))}>
            <option value="value">Day</option>
            <option value="month">Month</option>
            <option value="year">Year</option>
          </select>
        </label> : null}
        <label className="ts-group-totals-field">
          <span>Then by</span>
          <select aria-label="Then by" value={props.setup.then ?? ""} onChange={(event) => changeThen(event.currentTarget.value)}>
            <option value="">None</option>
            {groupable.filter((column) => column.id !== props.setup.dimension).map((column) => <option key={column.id} value={column.id}>{column.display_name}</option>)}
            {first && canThenBySameDate(first, props.setup.bucket) ? <option value={first.id}>{first.display_name}</option> : null}
          </select>
        </label>
        {then?.field_type === "date" ? <label className="ts-group-totals-field">
          <span>Then by date</span>
          <select aria-label="Then by date" value={props.setup.thenBucket} onChange={(event) => props.onChange({ ...props.setup, thenBucket: event.currentTarget.value as GroupSetup["bucket"] })}>
            <option value="value">Day</option>
            <option value="month">Month</option>
            {then.id === props.setup.dimension ? null : <option value="year">Year</option>}
          </select>
        </label> : null}
        <fieldset className="ts-group-totals-group">
          <legend>Sum</legend>
          {measures.map((column) => {
            const checked = props.setup.measures.includes(column.id);
            const disabled = checked ? props.setup.measures.length === 1 : props.setup.measures.length >= 4;
            return <label key={column.id} className="ts-group-totals-option">
              <input type="checkbox" checked={checked} disabled={disabled} onChange={() => toggleMeasure(column.id)} />
              <span>{column.display_name}</span>
            </label>;
          })}
        </fieldset>
        {props.filterHidesRows ? <fieldset className="ts-group-totals-group">
          <legend>Rows</legend>
          {props.shownScopeAvailable ? <label className="ts-group-totals-option">
            <input type="radio" name="ts-group-totals-rows" checked={props.scopeChoice === "shown"} onChange={() => props.onScopeChange("shown")} />
            <span>{`Shown rows (${props.shownRows})`}</span>
          </label> : null}
          <label className="ts-group-totals-option">
            <input type="radio" name="ts-group-totals-rows" checked={!props.shownScopeAvailable || props.scopeChoice === "all"} onChange={() => props.onScopeChange("all")} />
            <span>{`All rows (${props.totalRows})`}</span>
          </label>
          {props.shownScopeAvailable ? null : <p className="ts-hint">Too many shown rows to total separately; totals cover all rows.</p>}
        </fieldset> : null}
      </div>
      <div className={props.pending ? "ts-group-totals-results ts-group-totals--pending" : "ts-group-totals-results"} aria-busy={props.pending}>
        {refusal ? <p className="ts-dialog-error ts-row-error" role="alert">{refusal}</p> : null}
        {!refusal && projection ? <table className="ts-group-totals-table" aria-label={`Totals by ${headingName}`} onCopy={copyTable}>
          <thead>
            <tr>
              {projection.dimensions.map((dimension, index) => <th key={`dimension-${index}`} scope="col">{groupDimensionHeader(dimensionColumnsOfReply[index]!, dimension.bucket)}</th>)}
              <th scope="col" className="ts-group-totals-number">Rows</th>
              {measureColumnsOfReply.map((column, index) => <th key={`measure-${index}`} scope="col" className="ts-group-totals-number">{column?.display_name ?? projection.measures[index]}</th>)}
            </tr>
          </thead>
          <tbody>
            {projection.groups.map((group, row) => <tr key={row}>
              {group.keys.map((key, index) => index === 0
                ? <th key={index} scope="row">{groupKeyCell(key)}</th>
                : <td key={index}>{groupKeyCell(key)}</td>)}
              <td className="ts-group-totals-number">{group.rows}</td>
              {group.totals.map((total, index) => totalCell(total, measureColumnsOfReply[index]?.number_format, `group-${row}-total-${index}`))}
            </tr>)}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Total</th>
              {projection.dimensions.slice(1).map((_, index) => <td key={`spare-${index}`} />)}
              <td className="ts-group-totals-number">{projection.rows}</td>
              {projection.totals.map((total, index) => totalCell(total, measureColumnsOfReply[index]?.number_format, `scope-total-${index}`))}
            </tr>
          </tfoot>
        </table> : null}
        {!refusal && !projection && !props.pending ? <p className="ts-hint">Totals aren’t available right now. Close the panel and open it again to retry.</p> : null}
      </div>
      <div className="ts-group-totals-footer">
        <button type="button" className="ts-button" disabled={!tsv || props.pending} onClick={copy}>Copy</button>
        <p className="ts-hint ts-group-totals-status" role="status" aria-live="polite">{props.pending ? "Updating…" : copyStatus ?? ""}</p>
      </div>
    </section>
  );
}

/** A blank or empty key is a marked placeholder, never plain text that a value could spell. */
function groupKeyCell(key: Parameters<typeof groupKeyLabel>[0]) {
  const marker = groupKeyMarker(key);
  return marker
    ? <span className="ts-group-key-marker" title={marker.description}><span aria-hidden="true">{marker.label}</span><span className="ts-visually-hidden">{marker.description}</span></span>
    : groupKeyLabel(key);
}

function totalCell(total: number | null, format: Parameters<typeof formatNumberFor>[1], key: string) {
  return <td key={key} className={total === null ? "ts-group-totals-number ts-group-totals-unavailable" : "ts-group-totals-number"} title={total === null ? "A value in this column has no available result." : undefined}>
    {total === null ? "Unavailable" : formatNumberFor(total, format)}
  </td>;
}
