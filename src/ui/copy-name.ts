/** A display-only suggestion; the existing create-only store still owns collisions. */
export function suggestedCopyName(
  title: string | null,
  existingNames: readonly string[],
  savedInSession: Iterable<string> = [],
): string {
  const stem = title?.trim().replace(/\.(csv|xlsx|roproj|ro)$/i, "").trim() || "Untitled work";
  const base = `${stem} copy`;
  // An incomplete list still contains known names. Confirmed session saves
  // may not appear in that retained list until its asynchronous refresh ends.
  const names = new Set([...existingNames, ...savedInSession]);
  if (!names.has(base)) return base;
  let suffix = 2;
  while (names.has(`${base} ${suffix}`)) suffix += 1;
  return `${base} ${suffix}`;
}
