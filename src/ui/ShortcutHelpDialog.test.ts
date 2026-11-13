import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ShortcutHelpDialogView } from "./ShortcutHelpDialog.js";

it("renders a labelled dialog with grouped shortcuts and a close button", () => {
  const html = renderToStaticMarkup(createElement(ShortcutHelpDialogView, { mac: false, desktop: false, onClose: () => {} }));
  expect(html).toContain('aria-label="Keyboard shortcuts"');
  expect(html).toContain("<h3>Move</h3>");
  expect(html).toContain("<kbd>Ctrl+/</kbd>");
  expect(html).toContain('data-autofocus="true"');
  expect(html).not.toContain(">Quit</dd>");
});
