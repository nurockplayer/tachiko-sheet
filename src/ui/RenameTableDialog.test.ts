import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RenameTableDialog } from "./RenameTableDialog.js";

describe("rename table dialog", () => {
  it("offers the current name and rename and cancel actions", () => {
    const markup = renderToStaticMarkup(createElement(RenameTableDialog, {
      initialName: "Expenses", composing: () => false,
      onRename: async () => ({ kind: "confirmed" as const }), onClose: () => {},
    }));
    expect(markup).toContain('aria-label="Rename table"');
    expect(markup).toContain('value="Expenses"');
    expect(markup).toContain('>Cancel</button>');
    expect(markup).toContain('>Rename</button>');
  });
});
