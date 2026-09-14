import { useEffect, type RefObject } from "react";

import type { ReportConfiguration } from "../contracts.js";

export interface ReportDatum {
  category: string;
  value: number;
}

export function drawReportCanvas(
  canvas: HTMLCanvasElement,
  report: ReportConfiguration,
  groups: readonly ReportDatum[],
): void {
  const width = 720;
  const height = 360;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return;

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#1f2937";
  context.font = "600 20px system-ui, sans-serif";
  context.fillText(report.title || "Current report", 42, 38);
  const maximum = Math.max(1, ...groups.map((group) => Math.abs(group.value)));
  const left = 76;
  const top = 72;
  const chartWidth = 592;
  const chartHeight = 210;
  const bottom = top + chartHeight;
  context.strokeStyle = "#94a3b8";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(left, top);
  context.lineTo(left, bottom);
  context.lineTo(left + chartWidth, bottom);
  context.stroke();
  context.fillStyle = "#475569";
  context.font = "14px system-ui, sans-serif";
  context.fillText(report.valueLabel || "Value", 18, top + 8);
  context.fillText(report.categoryLabel || "Category", left + chartWidth - 72, bottom + 54);

  const spacing = chartWidth / Math.max(groups.length, 1);
  const points = groups.map((group, index) => ({
    ...group,
    x: left + spacing * (index + 0.5),
    y: bottom - (group.value / maximum) * chartHeight,
  }));
  if (report.type === "bar") {
    context.fillStyle = "#2563eb";
    for (const point of points) {
      const barWidth = Math.min(96, spacing * 0.6);
      context.fillRect(point.x - barWidth / 2, point.y, barWidth, bottom - point.y);
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
  for (const point of points) {
    context.fillText(point.category, point.x - 16, bottom + 22);
    context.fillText(String(point.value), point.x - 16, point.y - 10);
  }
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
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  report: ReportConfiguration;
  groups: readonly ReportDatum[];
}) {
  useEffect(() => {
    if (canvasRef.current) drawReportCanvas(canvasRef.current, report, groups);
  }, [canvasRef, groups, report]);
  return <canvas ref={canvasRef} className="ts-report-canvas" aria-hidden="true" />;
}
