import type { ReportConfiguration } from "../contracts.js";

/** Authored presentation only; definition existence and history belong to Work. */
export class DetachedReportPresentations {
  private occurrence: string | null = null;
  private readonly reports = new Map<string, ReportConfiguration>();

  observeOccurrence(occurrence: string | null): void {
    if (this.occurrence === occurrence) return;
    this.reports.clear();
    this.occurrence = occurrence;
  }

  /** Call only with a confirmed full discovery, never a targeted/failed read. */
  reconcile(
    occurrence: string,
    current: ReportConfiguration | null,
    definitionIds: readonly string[],
  ): ReportConfiguration | null {
    this.observeOccurrence(occurrence);
    if (current) {
      if (definitionIds.includes(current.definitionId)) return current;
      this.reports.delete(current.definitionId);
      this.reports.set(current.definitionId, current);
      return null;
    }
    // A workbook has one current report. Prefer the most recently detached
    // presentation if several definitions return in the same discovery.
    for (const [id, report] of [...this.reports].reverse()) {
      if (!definitionIds.includes(id)) continue;
      this.reports.delete(id);
      return report;
    }
    return null;
  }
}
