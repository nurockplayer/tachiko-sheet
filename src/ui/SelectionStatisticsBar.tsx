import type { NumberFormat, SelectionStatisticsProjection } from "../../public/core-kit/runtime/protocol.js";
import { formatNumberFor } from "./field-display.js";

export function SelectionStatisticsBar({ statistics, format }: { statistics: SelectionStatisticsProjection | "too-large"; format?: NumberFormat }) {
  if (statistics === "too-large") return <span className="ts-selection-statistics" data-testid="selection-statistics" aria-label="Selection statistics">
    <span className="ts-status-pair">Selection too large for statistics</span>
  </span>;
  const errors = statistics.error_count;
  const title = errors > 0 ? `${errors} ${errors === 1 ? "cell has" : "cells have"} formula errors` : undefined;
  const numeric = (value: number | null) => errors > 0 ? "Unavailable" : value === null ? "—" : formatNumberFor(value, format);
  return <span className="ts-selection-statistics" data-testid="selection-statistics" aria-label="Selection statistics">
    <span className="ts-status-pair">Count: <span data-testid="selection-count">{statistics.count}</span></span>
    {statistics.numerical_count > 0 || errors > 0 ? <>
      {(["sum", "average", "min", "max"] as const).map((key, index) => <span className="ts-status-pair" key={key} title={title}>
        {["Sum", "Average", "Min", "Max"][index]}: <span data-testid={`selection-${key}`}>{numeric(statistics[key])}</span>
      </span>)}
      <span className="ts-status-pair">Numerical count: <span data-testid="selection-numerical-count">{statistics.numerical_count}</span></span>
    </> : null}
  </span>;
}
