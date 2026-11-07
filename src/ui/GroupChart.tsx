import { useRef } from "react";
import { chartColorSlots, chartTicks, pieSlices, shortChartLabel, type GroupChartPoint, type GroupChartType } from "./group-chart.js";

// The panel's usual width, so text stays at its real size there.
const WIDTH = 340;

export function GroupChart({ type, points, name, format }: {
  type: GroupChartType;
  points: readonly GroupChartPoint[];
  /** Says what's charted, as in "Amount by Category". */
  name: string;
  format(value: number): string;
}) {
  const label = `${type === "bar" ? "Bar chart" : type === "line" ? "Line chart" : "Pie chart"} of ${name}`;
  if (type === "bar") return <BarChart label={label} points={points} format={format} />;
  if (type === "line") return <LineChart label={label} points={points} format={format} />;
  return <PieChart label={label} points={points} format={format} />;
}

type ChartProps = { label: string; points: readonly GroupChartPoint[]; format(value: number): string };

function BarChart({ label, points, format }: ChartProps) {
  const left = 96;
  const right = 20;
  const top = 22;
  const row = 24;
  const bar = 14;
  const ticks = chartTicks(points.map((point) => point.value), 3);
  const low = ticks[0]!;
  const high = ticks[ticks.length - 1]!;
  const x = (value: number) => left + ((value - low) / (high - low)) * (WIDTH - left - right);
  const height = top + row * points.length + 4;
  const zero = x(0);
  return <svg className="ts-group-chart-plot" data-testid="group-chart" role="img" aria-label={label} viewBox={`0 0 ${WIDTH} ${height}`}>
    {ticks.map((tick) => <g key={tick}>
      <line className="ts-chart-grid" x1={x(tick)} x2={x(tick)} y1={top - 4} y2={height - 4} />
      <text className="ts-chart-axis" x={x(tick)} y={top - 9} textAnchor="middle">{format(tick)}</text>
    </g>)}
    {points.map((point, index) => {
      const y = top + row * index;
      const end = x(point.value);
      const from = Math.min(zero, end);
      const width = Math.abs(end - zero);
      const radius = Math.min(4, width);
      // Round only the data end; the baseline side stays square.
      const path = point.value >= 0
        ? `M ${from} ${y + (row - bar) / 2} h ${width - radius} a ${radius} ${radius} 0 0 1 ${radius} ${radius} v ${bar - 2 * radius} a ${radius} ${radius} 0 0 1 ${-radius} ${radius} h ${radius - width} Z`
        : `M ${from + width} ${y + (row - bar) / 2} h ${radius - width} a ${radius} ${radius} 0 0 0 ${-radius} ${radius} v ${bar - 2 * radius} a ${radius} ${radius} 0 0 0 ${radius} ${radius} h ${width - radius} Z`;
      return <g key={`${point.label}-${index}`} data-chart-mark={point.value}>
        <title>{`${point.label}: ${format(point.value)}`}</title>
        <rect className="ts-chart-hit" x={0} y={y} width={WIDTH} height={row} />
        <text className="ts-chart-label" x={left - 8} y={y + row / 2} textAnchor="end" dominantBaseline="middle">{shortChartLabel(point.label, 14)}</text>
        {width > 0 ? <path className="ts-chart-bar" d={path} /> : null}
      </g>;
    })}
    <line className="ts-chart-baseline" x1={zero} x2={zero} y1={top - 4} y2={height - 4} />
  </svg>;
}

function LineChart({ label, points, format }: ChartProps) {
  const height = 190;
  const left = 56;
  const right = 16;
  const top = 12;
  const bottom = 28;
  const ticks = chartTicks(points.map((point) => point.value));
  const low = ticks[0]!;
  const high = ticks[ticks.length - 1]!;
  const x = (index: number) => points.length === 1 ? (left + WIDTH - right) / 2 : left + (index / (points.length - 1)) * (WIDTH - left - right);
  const y = (value: number) => top + ((high - value) / (high - low)) * (height - top - bottom);
  // At most four labels fit under the axis; the first and last always show.
  const every = Math.max(1, Math.ceil((points.length - 1) / 3));
  const labeled = (index: number) => index === points.length - 1 || (index % every === 0 && points.length - 1 - index >= every / 2);
  return <svg className="ts-group-chart-plot" data-testid="group-chart" role="img" aria-label={label} viewBox={`0 0 ${WIDTH} ${height}`}>
    {ticks.map((tick) => <g key={tick}>
      <line className={tick === 0 ? "ts-chart-baseline" : "ts-chart-grid"} x1={left} x2={WIDTH - right} y1={y(tick)} y2={y(tick)} />
      <text className="ts-chart-axis" x={left - 8} y={y(tick)} textAnchor="end" dominantBaseline="middle">{format(tick)}</text>
    </g>)}
    <polyline className="ts-chart-line" points={points.map((point, index) => `${x(index)},${y(point.value)}`).join(" ")} />
    {points.map((point, index) => <g key={`${point.label}-${index}`} data-chart-mark={point.value}>
      <title>{`${point.label}: ${format(point.value)}`}</title>
      <circle className="ts-chart-hit" cx={x(index)} cy={y(point.value)} r={12} />
      <circle className="ts-chart-marker" cx={x(index)} cy={y(point.value)} r={4} />
      {labeled(index) ? <text className="ts-chart-axis" x={x(index)} y={height - 10} textAnchor={points.length === 1 ? "middle" : index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"}>{shortChartLabel(point.label, 10)}</text> : null}
    </g>)}
  </svg>;
}

function PieChart({ label, points, format }: ChartProps) {
  const size = 200;
  const colors = useRef(new Map<string, number>());
  colors.current = chartColorSlots(colors.current, points.map((point) => point.label));
  const slot = (index: number) => colors.current.get(points[index]!.label) ?? 0;
  const slices = pieSlices(points.map((point) => point.value), size / 2, size / 2 - 4);
  const shareOf = (index: number) => slices.find((slice) => slice.index === index)?.fraction ?? 0;
  const percent = (fraction: number) => `${(fraction * 100).toFixed(fraction < 0.1 ? 1 : 0)}%`;
  return <div className="ts-group-chart-pie">
    <svg className="ts-group-chart-disc" data-testid="group-chart" role="img" aria-label={label} viewBox={`0 0 ${size} ${size}`}>
      {slices.map((slice) => {
        const point = points[slice.index]!;
        const style = { fill: `var(--ts-chart-${slot(slice.index) + 1})` };
        return <g key={slice.index} data-chart-mark={point.value}>
          <title>{`${point.label}: ${format(point.value)} (${percent(slice.fraction)})`}</title>
          {slice.path ? <path className="ts-chart-slice" style={style} d={slice.path} /> : <circle className="ts-chart-slice" style={style} cx={size / 2} cy={size / 2} r={size / 2 - 4} />}
        </g>;
      })}
    </svg>
    <ul className="ts-group-chart-legend">
      {points.map((point, index) => <li key={`${point.label}-${index}`}>
        <span className="ts-chart-swatch" aria-hidden="true" style={{ background: `var(--ts-chart-${slot(index) + 1})` }} />
        <span className="ts-chart-legend-name" title={point.label}>{point.label}</span>
        <span className="ts-chart-legend-value">{format(point.value)}</span>
        <span className="ts-chart-legend-value">{percent(shareOf(index))}</span>
      </li>)}
    </ul>
  </div>;
}
