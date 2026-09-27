import { fieldDisplay } from "./field-display.js";
import { fieldForColumn, type TableColumn, type TableRow } from "./projection-access.js";
import type { SheetShellProps } from "../contracts.js";

export interface BriefFactsProps {
  entity: string;
  occurrence: string;
  revision: string;
  currentness: SheetShellProps["currentness"];
  row: TableRow;
  columns: TableColumn[];
}

/**
 * Linked Brief facts for one entity. Every fact carries the actual
 * occurrence/revision/entity/currentness of the projection it was rendered from.
 */
export function BriefFacts({ entity, occurrence, revision, currentness, row, columns }: BriefFactsProps) {
  return (
    <table className="ts-fact-list" aria-label="Linked facts">
      <thead>
        <tr><th scope="col">Field</th><th scope="col">Value</th></tr>
      </thead>
      <tbody>
        {columns.map((column) => {
          const field = fieldForColumn(row, column.id);
          const display = fieldDisplay(field);
          const numeric = field?.calculated?.status === "value" || field?.stored?.kind === "number";
          return (
            <tr className="ts-fact" key={column.id}>
              <th className="ts-fact-key" scope="row">{column.key}</th>
              <td
                className={`ts-fact-value ts-cell--${display.tone}${numeric ? " ts-fact-value--numeric" : ""}`}
                data-testid={`brief:${entity}:${column.id}`}
                data-work-occurrence={occurrence}
                data-work-revision={revision}
                data-work-entity={entity}
                data-work-currentness={currentness}
                title={display.title ?? undefined}
              >
                {display.text}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
