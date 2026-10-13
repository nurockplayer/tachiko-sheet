/** Host attachment inventory only. Work owns the package and its meaning. */
export function workFileOmissions(attachments: { importedSource: boolean; report: boolean }): string[] {
  return [
    ...(attachments.importedSource ? ["The imported spreadsheet file and its import information, changes and warnings."] : []),
    ...(attachments.report ? ["Report settings, including the chart type and appearance."] : []),
  ];
}

export const WORK_FILE_SAVE_UNAVAILABLE = "Download the work file to keep these changes.";
export const WORK_FILE_DESKTOP_UNAVAILABLE = "Opening and downloading work files is available in the browser version only. It is not available in the Mac app yet.";

export function requireWorkFileName(name: string): void {
  if (!/\.ro$/i.test(name)) throw new Error("Choose a Tachiko work file ending in .ro. Nothing was opened.");
}

export function sameWorkFileOmissions(prepared: readonly string[], current: readonly string[]): boolean {
  return prepared.length === current.length && prepared.every((item, index) => item === current[index]);
}
