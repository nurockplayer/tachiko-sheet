import type { Currentness, KeyedGroupedSumResult, ReportConfiguration } from "../contracts.js";

export type ResultCardState = "A" | "B" | "C" | "C′" | "D" | "E" | "G" | "H" | "I" | "J" | "K";
export type ResultChartMode = "drawn" | "deferred" | "none";

export interface ResultCardModel {
  definitionId: string;
  title: string;
  state: ResultCardState;
  result: KeyedGroupedSumResult | null;
  report: ReportConfiguration | null;
  previous: boolean;
  showGroups: boolean;
  showChart: boolean;
  chartMode: ResultChartMode;
}

export function resultAnnouncementMessages(
  previous: ReadonlyMap<string, ResultCardState>,
  current: readonly Pick<ResultCardModel, "definitionId" | "title" | "state">[],
): string[] {
  const changes: string[] = [];
  for (const model of current) {
    const before = previous.get(model.definitionId);
    if (!before) continue;
    if (model.state === "J" && before !== "J") changes.push(`${model.title} is updating.`);
    else if ((model.state === "D" || model.state === "E") && before !== "D" && before !== "E") changes.push(`${model.title} needs attention.`);
    else if (["A", "B", "H", "I", "K"].includes(model.state) && ["J", "C", "C′", "G", "D", "E"].includes(before)) {
      changes.push(`${model.title} is up to date.`);
    }
  }
  return changes;
}

export function resultCardModels(input: {
  occurrence: string;
  revision: string;
  definitionIds: readonly string[];
  results: readonly KeyedGroupedSumResult[];
  currentness: Currentness;
  report: ReportConfiguration | null;
  priorChartModes?: ReadonlyMap<string, ResultChartMode>;
}): ResultCardModel[] {
  return input.definitionIds.map((definitionId, index) => {
    const candidates = input.results.filter((result) => result.definitionId === definitionId);
    const result = candidates.length === 1 ? candidates[0]! : null;
    const current = result?.revision === input.revision;
    const hasDiagnostics = Boolean(result && result.diagnostics.length > 0);
    const hasReport = input.report?.definitionId === definitionId ? input.report : null;
    const baseTitle = hasReport?.title.trim() || (index === 0 ? "Summary" : `Summary ${index + 1}`);
    const priorMode = input.priorChartModes?.get(`${input.occurrence}\u0000${definitionId}`) ?? "none";
    let state: ResultCardState;
    let previous = false;
    let showGroups = false;
    let showChart = false;
    let chartMode: ResultChartMode = "none";

    if (input.currentness === "unknown") {
      state = "G";
    } else if (input.currentness === "pending") {
      if (!result || hasDiagnostics) state = "J";
      else {
        previous = true;
        showGroups = true;
        if (hasReport?.type === "bar" && priorMode === "drawn") {
          state = "C";
          showChart = true;
          chartMode = "drawn";
        } else {
          state = "C′";
          chartMode = hasReport?.type === "line" || priorMode === "deferred" ? "deferred" : "none";
        }
      }
    } else if (!result || !current) {
      state = "E";
    } else if (hasDiagnostics) {
      state = "D";
    } else {
      showGroups = true;
      if (result.groups.length === 0) {
        state = "I";
      } else if (!hasReport) {
        state = "B";
      } else if (hasReport.type === "line") {
        state = "K";
        chartMode = "deferred";
      } else if (result.groups.length > 6 || result.groups.some((group) => !Number.isFinite(group.value) || group.value < 0) ||
        !result.groups.some((group) => group.value > 0)) {
        state = "H";
        chartMode = "deferred";
      } else {
        state = "A";
        showChart = true;
        chartMode = "drawn";
      }
    }

    return {
      definitionId,
      title: baseTitle,
      state,
      result,
      report: hasReport,
      previous,
      showGroups,
      showChart,
      chartMode,
    };
  });
}

export function resultChartLabelFit(
  groups: readonly { category: string; value: number }[],
  width: number,
  measure: (label: string) => number,
): boolean {
  const geometry = resultChartGeometry(width, groups.length);
  if (!geometry ||
    groups.some((group) => !Number.isFinite(group.value) || group.value < 0) ||
    !groups.some((group) => group.value > 0)) return false;
  return groups.every((group) => measure(String(group.value)) <= geometry.slot);
}

export function resultChartGeometry(width: number, groupCount: number): { left: number; right: number; slot: number; barWidth: number; baseline: number; height: number } | null {
  if (!Number.isFinite(width) || width <= 24 || groupCount < 1 || groupCount > 6) return null;
  const left = 12;
  const right = width - 12;
  const slot = (right - left) / groupCount;
  if (slot < 32) return null;
  return {
    left,
    right,
    slot,
    barWidth: Math.max(16, Math.min(56, slot - 16)),
    baseline: 196 - 45,
    height: 196,
  };
}

export function resultStatusLabel(state: ResultCardState): string {
  switch (state) {
    case "A": case "B": case "H": case "I": case "K": return "Up to date";
    case "C": case "C′": return "Updating…";
    case "J": return "Updating…";
    case "D": return "Needs attention";
    case "E": return "Needs attention";
    case "G": return "Needs refresh";
  }
}
