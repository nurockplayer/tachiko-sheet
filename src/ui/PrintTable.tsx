import { createPortal } from "react-dom";

import { cellDisplay, formatNumberFor } from "./field-display.js";
import { rowEntity, type TableColumn, type TableRow } from "./projection-access.js";
import "./print-table.css";

export interface PrintTableContentProps {
  /** The table's display name, shown as the printable heading. */
  tableName: string;
  columns: readonly TableColumn[];
  /** Every row the view shows, in view order; never only the windowed rows. */
  rows: readonly TableRow[];
  /** Work's column totals, when the grid shows its totals footer. */
  totals?: Record<string, number | null>;
  /** The grid's one-line view status, when sort or filter is active. */
  viewStatus?: string | null;
  /** Why a printout that would have totals has none (shown-row totals not ready). */
  totalsNote?: string | null;
}

/**
 * The printable document: a plain table in the main document, because
 * window.print() prints the whole document and a print-only element is the
 * only shape that works the same in browsers and the macOS app.
 */
export function PrintTableContent({ tableName, columns, rows, totals, viewStatus, totalsNote }: PrintTableContentProps) {
  return (
    <div
      className="ts-print-root"
      data-testid="print-root"
      data-orientation={columns.length > 6 ? "landscape" : "portrait"}
    >
      <h1 className="ts-print-title">{tableName}</h1>
      <p className="ts-print-meta">
        {`Printed ${new Date().toLocaleString()} · ${rows.length} ${rows.length === 1 ? "row" : "rows"}${viewStatus ? ` · ${viewStatus}` : ""}`}
      </p>
      <table className="ts-print-table">
        <thead>
          <tr>
            {columns.map((column) => <th key={column.id} scope="col">{column.display_name}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowEntity(row)}>
              {columns.map((column) => {
                return (
                  <td
                    key={column.id}
                    className={column.field_type === "number" ? "ts-print-cell ts-print-number" : "ts-print-cell"}
                  >
                    {cellDisplay(row, column).text}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        {totals ? (
          <tfoot>
            <tr>
              {columns.map((column) => {
                const hasTotal = Object.prototype.hasOwnProperty.call(totals, column.id);
                const total = totals[column.id];
                return (
                  <td key={column.id} data-column={column.id} className="ts-print-total">
                    {hasTotal ? total === null ? "Unavailable" : formatNumberFor(total, column.number_format) : null}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        ) : null}
      </table>
      {!totals && totalsNote ? <p className="ts-print-meta" data-testid="print-totals-note">{totalsNote}</p> : null}
    </div>
  );
}

export function PrintTable(props: PrintTableContentProps) {
  if (typeof document === "undefined") return null;
  return createPortal(<PrintTableContent {...props} />, document.body);
}
