/**
 * Pure presentation helpers for the "Totals by a column" panel.
 *
 * Work owns grouping, ordering and arithmetic. This module only names columns,
 * labels Work's keys, serializes its reply for the clipboard and picks which
 * row scope keeps the request under the wire limit.
 */
import type {
  ColumnProjection,
  GroupBucket,
  GroupDimension,
  GroupKey,
  GroupScope,
  GroupTotalsProjection,
} from "../../public/core-kit/runtime/protocol.js";
import { encodeTsv } from "./clipboard.js";
import { booleanText, formatNumber } from "./field-display.js";

/** A grouping column, with the bucket used when it is a Date. */
export type GroupSetup = {
  dimension: string;
  bucket: GroupBucket;
  then: string | null;
  thenBucket: GroupBucket;
  /** Measure column ids, in the user's order. */
  measures: string[];
};

type GroupHeaderColumn = Pick<ColumnProjection, "display_name" | "field_type">;
type GroupColumnIdentity = GroupHeaderColumn & { id: string };

export function groupableColumns(columns: readonly ColumnProjection[]): ColumnProjection[] {
  return columns.filter((column) => column.field_type === "text" || column.field_type === "date" || column.field_type === "boolean");
}

export function measureColumns(columns: readonly ColumnProjection[]): ColumnProjection[] {
  return columns.filter((column) => column.field_type === "number");
}

/** A Date dimension defaults to month; measures default to the first Number column. */
export function defaultGroupSetup(column: ColumnProjection, columns: readonly ColumnProjection[]): GroupSetup {
  const measure = measureColumns(columns)[0];
  return {
    dimension: column.id,
    bucket: "month",
    then: null,
    thenBucket: "month",
    measures: measure ? [measure.id] : [],
  };
}

/**
 * "Then by" may repeat the first Date column only to break years into months
 * or days; any other repeat would name the same grouping twice.
 */
export function canThenBySameDate(dimension: GroupColumnIdentity | null, dimensionBucket: GroupBucket): boolean {
  return dimension?.field_type === "date" && dimensionBucket === "year";
}

/** The setup after the first Date bucket changes: a repeat that no longer fits is dropped. */
export function withDimensionBucket(setup: GroupSetup, dimension: GroupColumnIdentity | null, bucket: GroupBucket): GroupSetup {
  const repeats = setup.then !== null && setup.then === setup.dimension;
  return repeats && !canThenBySameDate(dimension, bucket)
    ? { ...setup, bucket, then: null, thenBucket: "month" }
    : { ...setup, bucket };
}

export function groupDimensions(columns: readonly ColumnProjection[], setup: GroupSetup): GroupDimension[] {
  const first = columns.find((column) => column.id === setup.dimension);
  const dimensions: GroupDimension[] = [{ field: setup.dimension }];
  if (first?.field_type === "date") dimensions[0]!.bucket = setup.bucket;
  if (setup.then !== null) {
    const then = columns.find((column) => column.id === setup.then);
    dimensions.push({ field: setup.then });
    if (then?.field_type === "date") dimensions[1]!.bucket = setup.thenBucket;
  }
  return dimensions;
}

/** Text keys keep their value as is; an empty string and a blank group stay distinct. */
export function groupKeyLabel(key: GroupKey): string {
  switch (key.kind) {
    case "text":
      return key.value === "" ? "(empty)" : key.value;
    case "boolean":
      return booleanText(key.value);
    case "date":
    case "month":
    case "year":
      return key.value;
    case "blank":
      return "(blank)";
  }
}

export function groupDimensionHeader(column: GroupHeaderColumn, bucket: GroupBucket | undefined): string {
  if (column.field_type !== "date") return column.display_name;
  const suffix = bucket === "month" ? "month" : bucket === "year" ? "year" : "day";
  return `${column.display_name} (${suffix})`;
}

/** The table and the clipboard carry the same header, groups and Total row. */
export function groupTotalsTsv(projection: GroupTotalsProjection, columns: readonly ColumnProjection[]): string {
  const headers = projection.dimensions.map((dimension) => groupDimensionHeader(columnOf(columns, dimension.field), dimension.bucket));
  const measures = projection.measures.map((id) => columnOf(columns, id));
  const totalRow = [
    "Total",
    ...projection.dimensions.slice(1).map(() => ""),
    String(projection.rows),
    ...projection.totals.map((total) => total === null ? "" : formatNumber(total)),
  ];
  return encodeTsv([
    [...headers, "Rows", ...measures.map((column) => column.display_name)],
    ...projection.groups.map((group) => [
      ...group.keys.map(groupKeyLabel),
      String(group.rows),
      ...group.totals.map((total) => total === null ? "" : formatNumber(total)),
    ]),
    totalRow,
  ]);
}

export function groupRefusalMessage(code: string, message: string): string {
  if (code === "group_limit_exceeded") {
    return "More than 200 groups. Group by a column with fewer different values, or filter the rows first.";
  }
  if (code === "result_size_exceeded") {
    return "These totals are too large to show. Group by a column with shorter values, or filter the rows first.";
  }
  return `Totals are unavailable: ${message}`;
}

/**
 * The scope for the rows currently shown. The shorter of the shown and hidden
 * entity lists keeps the request under `maxBytes`; null means only all rows fit.
 */
export function groupScopeFor(
  shownEntities: readonly string[] | null,
  allEntities: readonly string[],
  maxBytes: number,
): GroupScope | null {
  if (shownEntities === null) return { kind: "all" };
  if (shownEntities.length >= allEntities.length) return { kind: "all" };
  const shown = new Set(shownEntities);
  const hidden = allEntities.filter((entity) => !shown.has(entity));
  const shownBytes = jsonBytes(shownEntities);
  const hiddenBytes = jsonBytes(hidden);
  if (shownBytes <= hiddenBytes) {
    return shownBytes > maxBytes ? null : { kind: "entities", entities: [...shownEntities] };
  }
  return hiddenBytes > maxBytes ? null : { kind: "except", entities: hidden };
}

function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function columnOf(columns: readonly ColumnProjection[], id: string): GroupHeaderColumn {
  return columns.find((column) => column.id === id) ?? { display_name: id, field_type: "unknown" };
}
