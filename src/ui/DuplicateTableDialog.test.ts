import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DuplicateTableDialogView } from "./DuplicateTableDialog.js";

function view(overrides: Partial<Parameters<typeof DuplicateTableDialogView>[0]> = {}): string {
  return renderToStaticMarkup(createElement(DuplicateTableDialogView, {
    name: "Expenses copy",
    pending: false,
    error: null,
    composing: () => false,
    onNameChange: () => {},
    onDuplicate: () => {},
    onCancel: () => {},
    ...overrides,
  }));
}

describe("duplicate table dialog", () => {
  it("offers the prefilled name and only the two actions", () => {
    const markup = view();
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('aria-label="Duplicate table"');
    expect(markup.match(/<input[^>]*>/)?.[0]).toContain('value="Expenses copy"');
    expect(markup).toContain(">Cancel</button>");
    expect(markup).toContain(">Duplicate</button>");
    expect(markup).not.toContain('role="alert"');
  });

  it("keeps the refusal inline with the draft while the dialog stays open", () => {
    const markup = view({ error: "This name is already used. Choose a distinct name.", pending: false });
    expect(markup).toContain('aria-modal="true"');
    const alert = markup.match(/<p[^>]*role="alert"[^>]*>[\s\S]*?<\/p>/)?.[0];
    expect(alert).toBeDefined();
    expect(alert).toContain('id="');
    expect(alert!.replace(/<[^>]*>/g, "")).toBe("This name is already used. Choose a distinct name.");
    const input = markup.match(/<input[^>]*>/)?.[0];
    expect(input).toContain('value="Expenses copy"');
    expect(input).toContain('aria-invalid="true"');
    expect(input).toContain('aria-describedby="');
  });
});
