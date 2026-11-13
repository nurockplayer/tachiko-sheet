import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ColumnAlignmentDialog } from "./ColumnAlignmentDialog.js";

describe("column alignment dialog", () => {
  it.each([null, "left", "center", "right"] as const)("selects the stored choice %s", alignment => {
    const markup = renderToStaticMarkup(createElement(ColumnAlignmentDialog, {
      columnName: "Amount", alignment, composing: () => false,
      onSubmit: async () => ({ kind: "confirmed" as const }), onCancel: () => {}, onSuccess: () => {},
    }));
    expect(markup).toContain('aria-label="Column alignment"');
    expect(markup.match(/type="radio"/g)).toHaveLength(4);
    expect(markup.match(/checked=""/g)).toHaveLength(1);
    const labels = [...markup.matchAll(/<label[^>]*>(.*?)<\/label>/g)].map(match => match[1]);
    expect(labels.map(label => label.replace(/<[^>]*>/g, "").trim())).toEqual(["Default (by type)", "Left", "Center", "Right"]);
    expect(labels[[null, "left", "center", "right"].indexOf(alignment)]).toContain('checked=""');
  });
});
