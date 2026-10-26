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
  const decimals = Number(draft.decimals);
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
