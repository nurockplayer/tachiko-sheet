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
    <dl className="ts-fact-list">
      {columns.map((column) => {
        const display = fieldDisplay(fieldForColumn(row, column.id));
        return (
          <div className="ts-fact" key={column.id}>
            <dt className="ts-fact-key">{column.key}</dt>
            <dd
              className={`ts-fact-value ts-cell--${display.tone}`}
              data-testid={`brief:${entity}:${column.id}`}
              data-work-occurrence={occurrence}
              data-work-revision={revision}
              data-work-entity={entity}
              data-work-currentness={currentness}
              title={display.title ?? undefined}
            >
              {display.text}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
