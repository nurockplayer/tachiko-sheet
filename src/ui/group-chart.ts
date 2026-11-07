import type { GroupTotalsProjection } from "../../public/core-kit/runtime/protocol.js";
import { groupKeyLabel, groupKeyMarker } from "./group-totals.js";

export type GroupChartType = "bar" | "line" | "pie";

export interface GroupChartPoint {
  /** Tells groups apart: labels can repeat, as a blank and the text "(blank)" do. */
  id: string;
  label: string;
  /** A blank or empty key, shown apart from text as in the table. */
  marked: boolean;
  value: number;
}

const MAX_MARKS = 50;
const MAX_SLICES = 8;
// Beyond these, axis arithmetic overflows or its step underflows to zero.
const LARGEST_VALUE = 1e300;
const SMALLEST_VALUE = 1e-300;

/** Work's groups for one measure, unchanged. Every number on the chart is one of these. */
export function groupChartPoints(projection: GroupTotalsProjection, measureIndex: number): GroupChartPoint[] | null {
  const points: GroupChartPoint[] = [];
  for (const group of projection.groups) {
    const value = group.totals[measureIndex];
    if (value === null || value === undefined) return null;
    points.push({
      id: JSON.stringify(group.keys),
      label: group.keys.map(groupKeyLabel).join(" · "),
      marked: group.keys.some((key) => groupKeyMarker(key) !== null),
      value,
    });
  }
  return points;
}

/** Why this chart can't show these points truthfully; null when it can. */
export function groupChartRefusal(type: GroupChartType, points: readonly GroupChartPoint[] | null): string | null {
  if (points === null) return "Some totals are unavailable, so there is no chart.";
  if (points.length === 0) return "There are no groups to chart.";
  if (points.some(({ value }) => value !== 0 && (Math.abs(value) > LARGEST_VALUE || Math.abs(value) < SMALLEST_VALUE))) {
    return "These totals are too large or too small to chart.";
  }
  if (type === "pie") {
    if (points.length > MAX_SLICES) return `A pie shows up to ${MAX_SLICES} groups. Use a bar chart, or filter the rows first.`;
    if (points.some((point) => point.value < 0)) return "A pie can't show negative totals. Use a bar chart.";
    if (points.every((point) => point.value === 0)) return "All the totals are zero, so a pie has nothing to show.";
    return null;
  }
  return points.length > MAX_MARKS ? `More than ${MAX_MARKS} groups won't fit in a chart. Group by a column with fewer different values, or filter the rows first.` : null;
}

/** Round axis ticks that include zero and cover every value. */
export function chartTicks(values: readonly number[], wanted = 4): number[] {
  const low = Math.min(0, ...values);
  const high = Math.max(0, ...values);
  if (low === high) return [0, 1];
  const rough = (high - low) / wanted;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = ([1, 2, 5, 10].find((multiple) => multiple * magnitude >= rough) ?? 10) * magnitude;
  const ticks: number[] = [];
  const last = Math.ceil(high / step);
  for (let index = Math.floor(low / step); index <= last; index += 1) ticks.push(index * step);
  return ticks;
}

export interface PieSlice {
  index: number;
  fraction: number;
  /** Null for a slice that fills the circle, which an SVG arc can't draw: its ends meet. */
  path: string | null;
}

export function pieSlices(values: readonly number[], center: number, radius: number): PieSlice[] {
  const total = values.reduce((sum, value) => sum + value, 0);
  const at = (turn: number): string => {
    const angle = 2 * Math.PI * turn - Math.PI / 2;
    return `${(center + radius * Math.cos(angle)).toFixed(2)} ${(center + radius * Math.sin(angle)).toFixed(2)}`;
  };
  const slices: PieSlice[] = [];
  let turn = 0;
  values.forEach((value, index) => {
    if (value === 0) return;
    const fraction = value / total;
    const start = at(turn);
    const end = at(turn + fraction);
    const path = fraction > 0.5 && start === end ? null : `M ${center} ${center} L ${start} A ${radius} ${radius} 0 ${fraction > 0.5 ? 1 : 0} 1 ${end} Z`;
    slices.push({ index, fraction, path });
    turn += fraction;
  });
  return slices;
}

/** Long labels are cut for the axis; the mark's tooltip carries the whole one. */
export function shortChartLabel(label: string, limit: number): string {
  const characters = Array.from(label);
  return characters.length > limit ? `${characters.slice(0, limit - 1).join("")}…` : label;
}

/**
 * A group keeps its hue while the panel is open, whatever else the filter
 * removes. Slots follow first appearance and start over only when all are taken.
 */
export function chartColorSlots(previous: ReadonlyMap<string, number>, ids: readonly string[], slots = MAX_SLICES): Map<string, number> {
  const next = new Map(previous);
  for (const id of ids) {
    if (next.has(id)) continue;
    const used = new Set(next.values());
    let free = 0;
    while (used.has(free) && free < slots) free += 1;
    if (free === slots) {
      next.clear();
      for (const [index, kept] of ids.entries()) next.set(kept, index % slots);
      return next;
    }
    next.set(id, free);
  }
  return next;
}
