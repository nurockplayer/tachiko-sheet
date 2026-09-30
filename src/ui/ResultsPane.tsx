import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { Currentness, KeyedGroupedSumResult, ReportConfiguration, SalesEntryTipMarker, ViewWitness, WorkbookView } from "../contracts.js";
import { resultAnnouncementMessages, resultCardModels, resultChartGeometry, resultChartLabelFit, resultStatusLabel, type ResultChartMode, type ResultCardState } from "./results-model.js";

export interface ResultsPaneProps {
  view: WorkbookView;
  currentness: Currentness;
  results: KeyedGroupedSumResult[];
  definitionIds: string[];
  report: ReportConfiguration | null;
  busy: boolean;
  priorChartModes: ReadonlyMap<string, ResultChartMode>;
  onChartMode(occurrence: string, definitionId: string, mode: ResultChartMode): void;
  onRefresh(witness: ViewWitness, definitionId: string): Promise<boolean>;
  onOpenSummary(): void;
  onOpenReport(): void;
  onHide(): void;
  hideButtonRef: RefObject<HTMLButtonElement | null>;
  chartFontKey: string;
}

const currentStates = new Set<ResultCardState>(["A", "B", "H", "I", "K"]);

export function ResultsPane(props: ResultsPaneProps) {
  const models = useMemo(() => resultCardModels({
    occurrence: props.view.occurrence,
    revision: props.view.revision,
    definitionIds: props.definitionIds,
    results: props.results,
    currentness: props.currentness,
    report: props.report,
    priorChartModes: props.priorChartModes,
  }), [props.view.occurrence, props.view.revision, props.definitionIds, props.results, props.currentness, props.report, props.priorChartModes]);

  const attention = models.some((model) => model.state === "D" || model.state === "E");
  const [liveMessage, setLiveMessage] = useState("");
  const previousAnnouncementRef = useRef<{ occurrence: string; states: Map<string, ResultCardState> } | null>(null);
  useEffect(() => {
    const prior = previousAnnouncementRef.current;
    const states = new Map(models.map((model) => [model.definitionId, model.state]));
    previousAnnouncementRef.current = { occurrence: props.view.occurrence, states };
    if (!prior || prior.occurrence !== props.view.occurrence) return;

    const changes = resultAnnouncementMessages(prior.states, models);
    if (changes.length) setLiveMessage(changes.join(" "));
  }, [models, props.view.occurrence]);

  return <section className="ts-results-pane" role="region" aria-label="Results" data-testid="results-pane">
    <div className="ts-results-heading">
      <div>
        <h2 className="ts-content-heading">Results</h2>
      </div>
      <span className="ts-visually-hidden" role="status" aria-live="polite" aria-atomic="true">{liveMessage}</span>
      <button ref={props.hideButtonRef} type="button" className="ts-button ts-results-hide" onClick={props.onHide}>Hide results</button>
    </div>
    <div className="ts-result-cards">
      {models.map((model) => <ResultCard
        key={model.definitionId}
        model={model}
        view={props.view}
        busy={props.busy}
        refresh={props.onRefresh}
        openSummary={props.onOpenSummary}
        openReport={props.onOpenReport}
        onChartMode={(mode) => props.onChartMode(props.view.occurrence, model.definitionId, mode)}
        chartFontKey={props.chartFontKey}
      />)}
    </div>
  </section>;
}

export function SalesTip(props: {
  marker: SalesEntryTipMarker;
  reportTitle: string;
  changed: boolean;
  currentness: Currentness;
  hasAttention: boolean;
  dismiss(): void;
}) {
  const title = props.reportTitle.trim() || "Results";
  let active = "try-it";
  if (props.currentness === "unknown") {
    active = "needs-refresh";
  } else if (props.currentness === "pending") {
    active = "updating";
  } else if (props.hasAttention) {
    active = "needs-attention";
  } else if (props.changed) {
    active = "updated";
  }
  const variants = [
    { key: "try-it", state: "Try it", icon: "bulb", side: `Change the PEN price. ${title} updates on the right.`, stacked: `Change the PEN price. ${title} updates below the table.` },
    { key: "updating", state: "Updating", icon: "clock", side: "Wait for confirmation before editing.", stacked: "Wait for confirmation before editing." },
    { key: "updated", state: "Updated", icon: "check", side: `${title} includes your change. Save a copy to keep it.`, stacked: `${title} includes your change. Save a copy to keep it.` },
    { key: "needs-attention", state: "Needs attention", icon: "attention", side: "Check Results for the next step.", stacked: "Check Results for the next step." },
    { key: "needs-refresh", state: "Needs refresh", icon: "attention", side: "Values could not be confirmed. Refresh first.", stacked: "Values could not be confirmed. Refresh first." },
  ] as const;
  return <aside className={`ts-sales-tip ts-sales-tip--${active}`} aria-label="Sales tip" data-testid="sales-tip" data-tip-state={active} data-tip-occurrence={props.marker.occurrence} data-tip-field={props.marker.field}>
    {variants.map((variant) => <div key={variant.key} className="ts-sales-tip-copy" data-tip-variant={variant.key} aria-hidden={active !== variant.key}>
      <TipIcon kind={variant.icon} />
      <strong>{variant.state}</strong>
      <span className="ts-sales-tip-body--side">{variant.side}</span>
      <span className="ts-sales-tip-body--stacked">{variant.stacked}</span>
    </div>)}
    <button type="button" className="ts-button ts-button--ghost ts-results-dismiss" aria-label="Dismiss tip" onClick={props.dismiss}>×</button>
  </aside>;
}

function TipIcon(props: { kind: "bulb" | "clock" | "check" | "attention" }) {
  return <svg className={`ts-sales-tip-icon ts-sales-tip-icon--${props.kind}`} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
    {props.kind === "bulb" ? <><path d="M7 14.5c-.3-1.4-2-2.2-2-5a5 5 0 1 1 10 0c0 2.8-1.7 3.6-2 5Z" /><path d="M7.5 16.5h5M8.5 18.5h3" /></> : null}
    {props.kind === "clock" ? <><circle cx="10" cy="10" r="7.5" /><path d="M10 5.5v4.8l3 1.8" /></> : null}
    {props.kind === "check" ? <><circle cx="10" cy="10" r="7.5" /><path d="m6.5 10.2 2.3 2.3 4.8-5" /></> : null}
    {props.kind === "attention" ? <><circle cx="10" cy="10" r="7.5" /><path d="M10 5.8v4.6M10 13.2v.1" /></> : null}
  </svg>;
}

function ResultCard(props: {
  model: ReturnType<typeof resultCardModels>[number];
  view: WorkbookView;
  busy: boolean;
  refresh(witness: ViewWitness, id: string): Promise<boolean>;
  openSummary(): void;
  openReport(): void;
  onChartMode(mode: ResultChartMode): void;
  chartFontKey: string;
}) {
  const { model } = props;
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const chartRegionRef = useRef<HTMLDivElement | null>(null);
  const [chartWidth, setChartWidth] = useState(0);
  const [fontGeneration, setFontGeneration] = useState(0);
  const result = model.result;
  const groups = result?.groups ?? [];
  const chartFits = Boolean(model.showChart && chartLabelFit(groups, chartWidth));
  const effectiveMode: ResultChartMode = model.showChart ? (chartFits ? "drawn" : "deferred") : model.chartMode;
  const displayState = model.state === "A" && model.showChart && !chartFits ? "H" : model.state;

  useEffect(() => {
    const node = chartRegionRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => setChartWidth(entries[0]?.contentRect.width ?? 0));
    observer.observe(node);
    setChartWidth(node.getBoundingClientRect().width);
    const remeasure = () => {
      setChartWidth(node.getBoundingClientRect().width);
      setFontGeneration((generation) => generation + 1);
    };
    document.fonts?.addEventListener("loadingdone", remeasure);
    return () => { observer.disconnect(); document.fonts?.removeEventListener("loadingdone", remeasure); };
  }, [props.chartFontKey]);

  useEffect(() => {
    if (["A", "H", "K"].includes(props.model.state)) props.onChartMode(effectiveMode);
  }, [effectiveMode, props.model.state, props.onChartMode, props.chartFontKey, fontGeneration]);

  const refresh = () => {
    headingRef.current?.focus();
    void props.refresh(witnessOf(props.view), model.definitionId);
  };
  const showOnlyRefresh = model.state === "E";
  const diagnosticActions = model.state === "D";
  const inertState = model.state === "G";
  const openReport = !diagnosticActions && Boolean(model.report);
  const showNavigation = !showOnlyRefresh && !diagnosticActions && !inertState;
  const caption = currentStates.has(model.state) ? "Current result" : model.state === "C" || model.state === "C′" ? "Previous result" : null;
  return <article className={`ts-result-card ts-result-card--${displayState.toLowerCase().replace("′", "-prime")}`} data-testid={`result-card:${model.definitionId}`} data-result-state={displayState}>
    <header className="ts-result-card-heading">
      <h3 ref={headingRef} className="ts-result-title" tabIndex={-1}>{model.title}</h3>
      <ResultStatus state={displayState} />
    </header>
    {caption ? <p className="ts-result-caption">{caption}</p> : null}
    {model.state === "D" ? <p className="ts-result-state-copy">This summary needs attention. Its values are hidden until the source data is corrected. Open the summary to see the details.</p> : null}
    {model.state === "E" ? <p className="ts-result-state-copy">This summary has no confirmed current result. Refresh it to try again. Its values are hidden until then.</p> : null}
    {model.state === "G" ? <p className="ts-result-state-copy">These results can’t be confirmed. Use Refresh in the header to read the work again. Values and chart are hidden until then.</p> : null}
    {model.state === "J" ? <p className="ts-result-reading">Reading the result…</p> : null}
    {model.state === "D" && result ? <ul className="ts-result-diagnostics" aria-label="Summary diagnostics">
      {result.diagnostics.map((diagnostic, index) => <li key={`${diagnostic.code}-${index}`}>{diagnostic.code}{diagnostic.lookup_key ? ` · ${diagnostic.lookup_key}` : ""}</li>)}
    </ul> : null}
    {model.state === "D" || model.state === "E" ? <div className="ts-result-actions">
      <button type="button" className="ts-button ts-button--primary" disabled={props.busy} onClick={refresh}>Refresh this summary</button>
      {diagnosticActions ? <button type="button" className="ts-button ts-button--ghost" disabled={props.busy} onClick={props.openSummary}>Open summary</button> : null}
    </div> : null}
    {model.showGroups && result ? <div className="ts-result-data">
      {model.state === "I" ? <div className="ts-result-empty"><p>No groups yet.</p><p>Groups appear when the source tables have matching rows.</p></div> : <table className="ts-result-values" aria-label={`${model.title} values`}>
        <thead><tr><th scope="col">{model.report?.categoryLabel ?? "Category"}</th><th scope="col">{model.report?.valueLabel ?? "Value"}</th></tr></thead>
        <tbody>{groups.map((group, index) => <tr key={`${group.category}-${index}`}><td>{group.category}</td><td>{group.value}</td></tr>)}</tbody>
      </table>}
      {model.state === "C" ? <div ref={chartRegionRef} className="ts-mini-chart-region ts-mini-chart-region--previous" aria-label="Previous chart hidden while results update"><div className="ts-mini-chart-placeholder">The chart is hidden while the result updates.</div></div> : null}
      {model.showChart && model.state !== "C" ? <div ref={chartRegionRef} className="ts-mini-chart-region">
        {chartFits ? <MiniBarChart groups={groups} width={chartWidth} categoryLabel={model.report?.categoryLabel ?? "Category"} valueLabel={model.report?.valueLabel ?? "Value"} /> : <p className="ts-result-deferred">The chart is shown in Report.</p>}
      </div> : null}
      {model.chartMode === "deferred" && !model.showChart ? <p className="ts-result-deferred">The chart is shown in Report.</p> : null}
    </div> : null}
    {showNavigation ? <footer className="ts-result-card-footer">
      <button type="button" className="ts-button ts-button--ghost" onClick={openReport ? props.openReport : props.openSummary}>{openReport ? "Open report" : "Open summary"}</button>
    </footer> : null}
  </article>;
}

function ResultStatus(props: { state: ResultCardState }) {
  const glyph = ["A", "B", "H", "I", "K"].includes(props.state) ? "●" : ["C", "C′", "J"].includes(props.state) ? "◐" : ["D", "E"].includes(props.state) ? "!" : "?";
  return <span className={`ts-result-status ts-result-status--${props.state.toLowerCase().replace("′", "-prime")}`}>
    <span className="ts-result-status-glyph" aria-hidden="true">{glyph}</span>
    <span>{resultStatusLabel(props.state)}</span>
  </span>;
}

function chartLabelFit(groups: readonly { category: string; value: number }[], width: number): boolean {
  if (typeof document === "undefined") return false;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return false;
  context.font = "12px system-ui";
  return resultChartLabelFit(groups, width, (label) => context.measureText(label).width);
}

function MiniBarChart(props: { groups: readonly { category: string; value: number }[]; width: number; categoryLabel: string; valueLabel: string }) {
  const geometry = resultChartGeometry(props.width, props.groups.length);
  if (!geometry) return null;
  const max = Math.max(...props.groups.map((group) => group.value));
  const { height, left, right, baseline, slot, barWidth } = geometry;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (context) context.font = "12px system-ui";
  return <svg className="ts-mini-chart" viewBox={`0 0 ${Math.max(1, props.width)} ${height}`} aria-hidden="true" focusable="false">
    <text x={left} y="12" className="ts-mini-chart-axis">{props.valueLabel}</text>
    <line x1={left} x2={right} y1={baseline} y2={baseline} stroke="#8a90a2" />
    {props.groups.map((group, index) => {
      const x = left + slot * index + (slot - barWidth) / 2;
      const barHeight = group.value === 0 ? 0 : 100 * group.value / max;
      const y = baseline - barHeight;
      const maxLabelWidth = Math.max(0, slot - 4);
      const full = group.category;
      const labelParts = Array.from(full);
      let label = full;
      while (label && context && context.measureText(label).width > maxLabelWidth) {
        labelParts.pop();
        label = labelParts.join("");
      }
      if (label !== full) {
        while (label && context && context.measureText(`${label}…`).width > maxLabelWidth) {
          labelParts.pop();
          label = labelParts.join("");
        }
        label = label ? `${label}…` : "…";
      }
      return <g key={`${group.category}-${index}`}>
        {barHeight > 0 ? <rect x={x} y={y} width={barWidth} height={barHeight} rx="2" fill="#2563eb" /> : null}
        <text x={x + barWidth / 2} y={Math.max(13, y - 5)} textAnchor="middle" className="ts-mini-chart-value">{group.value}</text>
        <text x={left + slot * index + slot / 2} y={baseline + 14} textAnchor="middle" className="ts-mini-chart-category">{label}</text>
      </g>;
    })}
    <text x={(left + right) / 2} y={height - 3} textAnchor="middle" className="ts-mini-chart-axis">{props.categoryLabel}</text>
  </svg>;
}

function witnessOf(view: WorkbookView): ViewWitness { return { occurrence: view.occurrence, revision: view.revision }; }
