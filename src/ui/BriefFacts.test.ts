import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { FieldProjection } from "../../public/core-kit/experimental-client.js";
import { BriefFacts } from "./BriefFacts.js";

function fact({ required = false, value = "", blank = false, missing = false }: { required?: boolean; value?: string; blank?: boolean; missing?: boolean } = {}) {
  const field: FieldProjection = { target: { entity: "entity", field: "field" }, address: "field", stored: { kind: "text", value },
    formula: null, calculated: null, diagnostics: [], editable_scalar: "text" };
  return renderToStaticMarkup(createElement(BriefFacts, {
    entity: "entity", occurrence: "occurrence", revision: "revision", currentness: "current",
    columns: [{ id: "field", key: "field", display_name: "Field", field_type: "text", required }],
    row: { id: "entity", key: "entity", fields: blank || missing ? [] : [field], blank_fields: blank ? ["field"] : [] },
  }));
}

describe("Brief fact presence display", () => {
  it("marks optional stored empty Text visually while announcing Empty text", () => {
    const markup = fact();
    expect(markup).toContain('ts-cell--empty-text');
    expect(markup).toContain('aria-description="Empty text"');
    expect(markup).toContain('<span class="ts-cell-value" aria-hidden="true">&quot;&quot;</span>');
    expect(markup).not.toContain('title="Empty text"');
  });
  it("keeps sparse authoritative blanks visually empty and describes them as Blank", () => {
    const markup = fact({ blank: true });
    expect(markup).toContain('aria-description="Blank"');
    expect(markup).toContain('<span class="ts-cell-value"></span>');
    expect(markup).not.toContain('ts-cell--empty-text');
    expect(markup).not.toContain('&quot;&quot;');
  });
  it("keeps required empty Text unmarked, with its accessible description", () => {
    const markup = fact({ required: true });
    expect(markup).toContain('aria-description="Empty text"');
    expect(markup).toContain('<span class="ts-cell-value"></span>');
    expect(markup).not.toContain('ts-cell--empty-text');
  });
  it("preserves whitespace and never assumes a missing field is blank", () => {
    expect(fact({ value: " " })).toContain('<span class="ts-cell-value"> </span>');
    const markup = fact({ missing: true });
    expect(markup).not.toContain('aria-description=');
    expect(markup).not.toContain('ts-cell--empty-text');
    expect(markup).toContain('title="No value"');
  });
});
