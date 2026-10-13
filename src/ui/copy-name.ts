/** A display-only suggestion; the existing create-only store still owns collisions. */
export function suggestedCopyName(title: string | null, existingNames: readonly string[]): string {
  const stem = title?.trim().replace(/\.(csv|xlsx|roproj|ro)$/i, "").trim() || "Untitled work";
  const base = `${stem} copy`;
  const names = new Set(existingNames);
  if (!names.has(base)) return base;
  let suffix = 2;
  while (names.has(`${base} ${suffix}`)) suffix += 1;
  return `${base} ${suffix}`;
}
