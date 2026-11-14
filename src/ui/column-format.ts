import type { NumberFormat } from "../../public/core-kit/runtime/protocol.js";
import type { RowCommandOutcome } from "../contracts.js";

export interface ColumnFormatDraft { type: "plain" | "currency" | "percent"; code: string; decimals: string; thousandsSeparator: boolean }

export function columnFormatDraft(format?: NumberFormat): ColumnFormatDraft {
  return {
    type: format?.kind.type ?? "plain",
    code: format?.kind.type === "currency" ? format.kind.code : "USD",
    decimals: String(format?.decimals ?? 2),
    thousandsSeparator: format?.thousands_separator ?? true,
  };
}

export function columnFormatInput(draft: ColumnFormatDraft): { input: NumberFormat } | { error: string } {
  // Number("") is 0, so an emptied field must be refused before conversion.
  const decimals = draft.decimals.trim() === "" ? Number.NaN : Number(draft.decimals);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 10) return { error: "Enter 0 to 10 decimal places." };
  const code = draft.code.toUpperCase();
  if (draft.type === "currency" && !/^[A-Z]{3}$/.test(code)) return { error: "Enter a three-letter currency code." };
  return { input: {
    decimals,
    kind: draft.type === "currency" ? { type: "currency", code } : { type: draft.type },
    thousands_separator: draft.thousandsSeparator,
  } };
}

export interface ColumnFormatSettlement { close: boolean; error: string | null; confirmed: boolean }
export function columnFormatSettlement(result: RowCommandOutcome): ColumnFormatSettlement {
  if (result.kind === "refused") return { close: false, error: result.message, confirmed: false };
  return { close: true, error: null, confirmed: result.kind === "confirmed" };
}

export type StripNumberAction = "currency" | "percent" | "separator" | "fewer" | "more";
export function nextStripNumberFormat(format: NumberFormat | undefined, action: StripNumberAction): NumberFormat {
  const current: NumberFormat = format ?? { decimals: 2, kind: { type: "plain" }, thousands_separator: false };
  switch (action) {
    case "currency": return { ...current, kind: current.kind.type === "currency" ? { type: "plain" } : { type: "currency", code: "USD" } };
    case "percent": return { ...current, kind: { type: current.kind.type === "percent" ? "plain" : "percent" } };
    case "separator": return { ...current, thousands_separator: !current.thousands_separator };
    case "fewer": return { ...current, decimals: Math.max(0, current.decimals - 1) };
    case "more": return { ...current, decimals: Math.min(10, current.decimals + 1) };
  }
}
export function nextStripAlignment(current: "left" | "center" | "right" | null | undefined, action: "left" | "center" | "right") {
  return current === action ? null : action;
}
