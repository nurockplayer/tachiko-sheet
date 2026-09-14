import { useEffect, type RefObject } from "react";

import type { ReportConfiguration } from "../contracts.js";

export interface ReportDatum {
  category: string;
  value: number;
}

interface ReportPoint extends ReportDatum {
  x: number;
  y: number;
  categoryLines: string[];
}

export interface ReportCanvasLayout {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  zeroY: number;
  titleLines: string[];
  valueLabelLines: string[];
  categoryLabelLines: string[];
  valueLabelTop: number;
  categoryLabelTop: number;
  points: ReportPoint[];
}

function wrapText(text: string, width: number, measureText: (text: string) => number): string[] {
  const characters = Array.from(text);
  const lines: string[] = [];
  let line = "";
  for (const character of characters) {
    const candidate = line + character;
    if (line && measureText(candidate) > width) {
      lines.push(line);
      line = character;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [""];
}

/** Rendering geometry only: values remain the unmodified authoritative group projection. */
export function reportCanvasLayout(
  report: ReportConfiguration,
  groups: readonly ReportDatum[],
  measureText: (text: string) => number,
  measureTitle: (text: string) => number = measureText,
): ReportCanvasLayout {
  if (groups.some((group) => !Number.isFinite(group.value))) {
    throw new RangeError("Current report values must be finite numbers.");
  }
  const left = 76;
  const right = 56;
  const legendWidth = report.legendVisible ? 176 : 0;
  const slotWidths = groups.map((group) => Math.max(
    96,
    Math.min(260, Math.max(measureText(group.category), measureText(String(group.value)))) + 28,
  ));
  const chartWidth = Math.max(592, slotWidths.reduce((total, width) => total + width, 0));
  const width = Math.ceil(Math.max(720, left + chartWidth + right));
  const titleLines = wrapText(report.title, Math.max(180, width - left - right - legendWidth), measureTitle);
  const valueLabelLines = wrapText(report.valueLabel, chartWidth, measureText);
  const valueLabelTop = 38 + titleLines.length * 24;
  const top = valueLabelTop + valueLabelLines.length * 16 + 18;
  const chartHeight = 210;
  const bottom = top + chartHeight;
  const values = groups.map((group) => group.value);
  let minimum = Math.min(0, ...values);
  let maximum = Math.max(0, ...values);
  if (minimum === maximum) {
    minimum -= 1;
    maximum += 1;
  }
  const span = maximum - minimum;
  if (!Number.isFinite(span) || span <= 0) throw new RangeError("Current report range is not renderable.");
  const categoryLines = groups.map((group, index) => wrapText(group.category, Math.max(72, slotWidths[index]! - 12), measureText));
  const categoryHeight = Math.max(1, ...categoryLines.map((lines) => lines.length)) * 16;
  const categoryLabelLines = wrapText(report.categoryLabel, chartWidth, measureText);
  const categoryLabelTop = bottom + 20 + categoryHeight + 16;
  const height = Math.ceil(Math.max(360, categoryLabelTop + categoryLabelLines.length * 16 + 24));
  let offset = left;
  const points = groups.map((group, index) => {
    const slotWidth = slotWidths[index]!;
    const x = offset + slotWidth / 2;
    offset += slotWidth;
    return {
      ...group,
      x,
      y: top + ((maximum - group.value) / span) * chartHeight,
      categoryLines: categoryLines[index]!,
    };
  });
  return {
    width,
    height,
    left,
    right,
    top,
    bottom,
    zeroY: top + (maximum / span) * chartHeight,
    titleLines,
    valueLabelLines,
    categoryLabelLines,
    valueLabelTop,
    categoryLabelTop,
    points,
  };
}

export function drawReportCanvas(
  canvas: HTMLCanvasElement,
  report: ReportConfiguration,
  groups: readonly ReportDatum[],
): void {
  canvas.width = 720;
  canvas.height = 360;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("A 2D Canvas context is unavailable.");

  const measureBody = (text: string) => {
    context.font = "14px system-ui, sans-serif";
    return context.measureText(text).width;
  };
  const measureTitle = (text: string) => {
    context.font = "600 20px system-ui, sans-serif";
    return context.measureText(text).width;
  };
  if (groups.length === 0) {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#1f2937";
    context.font = "600 20px system-ui, sans-serif";
    context.fillText(report.title, 76, 38);
    context.fillStyle = "#475569";
    context.font = "14px system-ui, sans-serif";
    context.fillText("No groups in the current result.", 76, 104);
    return;
  }
  const layout = reportCanvasLayout(report, groups, measureBody, measureTitle);
  canvas.width = layout.width;
  canvas.height = layout.height;
  if (canvas.width !== layout.width || canvas.height !== layout.height) {
    throw new Error("The report image is too large for this browser to render.");
  }
  const width = layout.width;
  const { height, left, right, top, bottom, zeroY, points } = layout;

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#1f2937";
  context.font = "600 20px system-ui, sans-serif";
  layout.titleLines.forEach((line, index) => context.fillText(line, left, 38 + index * 24));
  const chartWidth = width - left - right;
  context.strokeStyle = "#94a3b8";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(left, top);
  context.lineTo(left, bottom);
  context.moveTo(left, zeroY);
  context.lineTo(left + chartWidth, zeroY);
  context.stroke();
  context.fillStyle = "#475569";
  context.font = "14px system-ui, sans-serif";
  layout.valueLabelLines.forEach((line, index) => context.fillText(line, left, layout.valueLabelTop + index * 16));

  if (report.type === "bar") {
    context.fillStyle = "#2563eb";
    for (const [index, point] of points.entries()) {
      const nextX = points[index + 1]?.x ?? left + chartWidth;
      const previousX = points[index - 1]?.x ?? left;
      const barWidth = Math.min(96, Math.max(18, (nextX - previousX) * 0.3));
      context.fillRect(point.x - barWidth / 2, Math.min(point.y, zeroY), barWidth, Math.abs(zeroY - point.y));
    }
  } else {
    context.strokeStyle = "#7c3aed";
    context.lineWidth = 3;
    context.beginPath();
    points.forEach((point, index) => {
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    });
    context.stroke();
    context.fillStyle = "#7c3aed";
    for (const point of points) {
      context.beginPath();
      context.arc(point.x, point.y, 5, 0, Math.PI * 2);
      context.fill();
    }
  }
  context.fillStyle = "#334155";
  context.font = "14px system-ui, sans-serif";
  context.textAlign = "center";
  for (const point of points) {
    point.categoryLines.forEach((line, index) => context.fillText(line, point.x, bottom + 20 + index * 16));
    const valueY = point.y <= top + 18 ? point.y + 16 : point.y - 8;
    context.fillText(String(point.value), point.x, valueY);
  }
  layout.categoryLabelLines.forEach((line, index) => context.fillText(line, left + chartWidth / 2, layout.categoryLabelTop + index * 16));
  context.textAlign = "start";
  if (report.legendVisible) {
    context.fillStyle = report.type === "bar" ? "#2563eb" : "#7c3aed";
    context.fillRect(width - 164, 22, 12, 12);
    context.fillStyle = "#334155";
    context.fillText(report.type === "bar" ? "Bar series" : "Line series", width - 144, 33);
  }
}

export function ReportCanvas({
  canvasRef,
  report,
  groups,
  onRenderState,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  report: ReportConfiguration;
  groups: readonly ReportDatum[];
  onRenderState: (ready: boolean) => void;
}) {
  useEffect(() => {
    try {
      if (!canvasRef.current) throw new Error("The report canvas is unavailable.");
      drawReportCanvas(canvasRef.current, report, groups);
      canvasRef.current.dataset.reportReady = "true";
      onRenderState(true);
    } catch {
      if (canvasRef.current) {
        canvasRef.current.width = 1;
        canvasRef.current.height = 1;
        canvasRef.current.dataset.reportReady = "false";
      }
      onRenderState(false);
    }
  }, [canvasRef, groups, onRenderState, report]);
  return <canvas ref={canvasRef} className="ts-report-canvas" aria-hidden="true" />;
}
