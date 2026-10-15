/** Translate Work's typed name refusals; never validate or normalize input here. */
export interface NameRefusals { table: string[]; columns: Record<number, string[]> }
const messages: Record<string, string> = {
  empty_display_name: "Enter a name that isn't only spaces.",
  display_name_too_long: "This name is too long. Use a shorter name (up to 4,096 UTF-8 bytes).",
  forbidden_display_name_scalar: "Remove control characters or line breaks from this name.",
  duplicate_display_name: "This name is already used. Choose a distinct name.",
};
export function nameRefusals(error: unknown): NameRefusals | null {
  const failures = (error as { failure?: { name_failures?: Array<{ reason: string; inputs: Array<{kind: string; index?: number}> }> } } | null)?.failure?.name_failures;
  if (!Array.isArray(failures) || failures.length === 0) return null;
  const result: NameRefusals = { table: [], columns: {} };
  for (const failure of failures) {
    const message = messages[failure.reason] ?? "This name was refused. Choose another name.";
    for (const input of failure.inputs) {
      const list = input.kind === "table" ? result.table : input.kind === "column" && Number.isInteger(input.index)
        ? (result.columns[input.index!] ??= []) : null;
      if (list && !list.includes(message)) list.push(message);
    }
  }
  return result;
}
