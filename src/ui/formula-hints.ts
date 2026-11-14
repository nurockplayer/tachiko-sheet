export interface FormulaFunction { name: string; args: string; summary: string }

export const FORMULA_FUNCTIONS: readonly FormulaFunction[] = [
  { name: "SUM", args: "number1, [number2], …", summary: "Adds numbers" },
  { name: "AVERAGE", args: "number1, [number2], …", summary: "Average of numbers" },
  { name: "COUNT", args: "value1, [value2], …", summary: "Counts cells that hold numbers" },
  { name: "MIN", args: "number1, [number2], …", summary: "Smallest number" },
  { name: "MAX", args: "number1, [number2], …", summary: "Largest number" },
  { name: "IF", args: "logical_test, value_if_true, value_if_false", summary: "Picks a value by a test" },
  { name: "AND", args: "logical1, [logical2], …", summary: "True when every test is true" },
  { name: "OR", args: "logical1, [logical2], …", summary: "True when any test is true" },
  { name: "NOT", args: "logical", summary: "Reverses a test" },
  { name: "IFERROR", args: "value, value_if_error", summary: "A fallback when the value is an error" },
  { name: "ROUND", args: "number, num_digits", summary: "Rounds to digits" },
  { name: "ROUNDUP", args: "number, num_digits", summary: "Rounds away from zero" },
  { name: "ROUNDDOWN", args: "number, num_digits", summary: "Rounds toward zero" },
  { name: "ABS", args: "number", summary: "Absolute value" },
  { name: "ISBLANK", args: "value", summary: "True when the cell is empty" },
  { name: "YEAR", args: "date", summary: "The year of a date" },
  { name: "MONTH", args: "date", summary: "The month of a date" },
  { name: "DAY", args: "date", summary: "The day of a date" },
  { name: "WEEKDAY", args: "date, [return_type]", summary: "Day of the week as a number" },
  { name: "DAYS", args: "end_date, start_date", summary: "Days between two dates" },
  { name: "VLOOKUP", args: "lookup_value, table_array, col_index_num, FALSE", summary: "Finds a value by exact match" },
  { name: "XLOOKUP", args: "lookup_value, lookup_array, return_array, [if_not_found]", summary: "Finds a value by exact match" },
  { name: "INDEX", args: "array, row_num", summary: "The value at a position" },
  { name: "MATCH", args: "lookup_value, lookup_array, 0", summary: "Position of an exact match" },
  { name: "SUMIF", args: "range, criteria, [sum_range]", summary: "Sum of cells that meet a condition" },
  { name: "SUMIFS", args: "sum_range, criteria_range1, criteria1, …", summary: "Sum of cells that meet all conditions" },
  { name: "AVERAGEIF", args: "range, criteria, [average_range]", summary: "Average of cells that meet a condition" },
  { name: "AVERAGEIFS", args: "average_range, criteria_range1, criteria1, …", summary: "Average of cells that meet all conditions" },
  { name: "COUNTIF", args: "range, criteria", summary: "Count of cells that meet a condition" },
  { name: "COUNTIFS", args: "criteria_range1, criteria1, …", summary: "Count of cells that meet all conditions" },
];

function scan(value: string, caret: number): { inString: boolean; stack: (string | null)[] } {
  let inString = false;
  const stack: (string | null)[] = [];
  for (let i = 0; i < caret; i++) {
    const c = value[i];
    if (c === '"') {
      if (inString && value[i + 1] === '"' && i + 1 < caret) i++;
      else inString = !inString;
    } else if (!inString && c === "(") {
      const prefix = value.slice(0, i);
      const match = /(?:^|[=+\-*/^&<>,(\s])([A-Za-z]+)$/.exec(prefix);
      stack.push(match?.[1]?.toUpperCase() ?? null);
    } else if (!inString && c === ")") stack.pop();
  }
  return { inString, stack };
}

export function functionSuggestions(value: string, caret: number): { start: number; end: number; names: string[] } | null {
  if (!value.startsWith("=") || scan(value, caret).inString || /[A-Za-z(]/.test(value[caret] ?? "")) return null;
  const match = /(?:^|[=+\-*/^&<>,(\s])([A-Za-z]+)$/.exec(value.slice(0, caret));
  if (!match) return null;
  const token = match[1]!.toUpperCase();
  const names = FORMULA_FUNCTIONS.filter(item => item.name.startsWith(token)).map(item => item.name).slice(0, 8);
  if (!names.length || (names.length === 1 && names[0] === token)) return null;
  return { start: caret - token.length, end: caret, names };
}

export function functionHint(value: string, caret: number): FormulaFunction | null {
  if (!value.startsWith("=")) return null;
  const { inString, stack } = scan(value, caret);
  if (inString) return null;
  for (let i = stack.length - 1; i >= 0; i--) {
    const found = FORMULA_FUNCTIONS.find(item => item.name === stack[i]);
    if (found) return found;
  }
  return null;
}

export function insertFunction(value: string, s: { start: number; end: number }, name: string): { value: string; caret: number } {
  return { value: value.slice(0, s.start) + name + "(" + value.slice(s.end), caret: s.start + name.length + 1 };
}
