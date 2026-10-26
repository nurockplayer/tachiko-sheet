import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ColumnRuleDialogView } from "./ColumnRuleDialog.js";
import type { ColumnRuleDraft } from "./column-rule.js";

function view(overrides: Partial<Parameters<typeof ColumnRuleDialogView>[0]> = {}): string {
  return renderToStaticMarkup(createElement(ColumnRuleDialogView, {
    columnName: "Status",
    draft: { kind: "list", values: "Todo\nDoing\nDone", min: "", max: "" },
    hasRule: false,
    pending: false,
    error: null,
    composing: () => false,
    onDraftChange: () => {},
    onSave: () => {},
    onRemove: () => {},
    onCancel: () => {},
    ...overrides,
  }));
}

describe("column rule dialog", () => {
  it("shows the prefilled list and Save and Cancel without Remove", () => {
    const markup = view();
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-label="Column rule"');
    expect(markup.match(/<textarea[^>]*>/)?.[0]).toContain('data-autofocus="true"');
    expect(markup).toContain("Todo\nDoing\nDone");
    expect(markup).toContain("Save rule");
    expect(markup).toContain(">Cancel</button>");
    expect(markup).not.toContain("Remove rule");
  });

  it("shows both labelled inputs for a range", () => {
    const draft: ColumnRuleDraft = { kind: "range", values: "", min: "1", max: "5" };
    const markup = view({ draft });
    expect(markup).toContain(">Lowest value</label>");
    expect(markup).toContain(">Highest value</label>");
    expect(markup.match(/<input[^>]*>/g)).toHaveLength(2);
    expect(markup).toContain('inputMode="decimal"');
  });

  it("offers Remove rule when a rule exists", () => {
    expect(view({ hasRule: true })).toContain(">Remove rule</button>");
  });

  it("shows an inline error and marks the input invalid", () => {
    const markup = view({ error: "Enter at least one allowed value." });
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Enter at least one allowed value.");
    expect(markup.match(/<textarea[^>]*>/)?.[0]).toContain('aria-invalid="true"');
    expect(markup.match(/<textarea[^>]*>/)?.[0]).toContain('aria-describedby="');
  });

  it("disables every action while pending", () => {
    const markup = view({ hasRule: true, pending: true });
    const buttons = markup.match(/<button[^>]*>/g) ?? [];
    expect(buttons.length).toBe(3);
    expect(buttons.every(button => button.includes("disabled"))).toBe(true);
    expect(markup).toContain("Working…");
    expect(markup).toContain('aria-busy="true"');
  });
});
