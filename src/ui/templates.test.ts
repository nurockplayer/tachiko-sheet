import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TemplatePickerView } from "./TemplatePicker.js";
import { openTemplateChoice, TEMPLATES } from "./templates.js";

type ButtonProps = { "aria-label"?: string; onClick?: () => void; disabled?: boolean };

function findButton(node: ReactNode, label: string): ReactElement<ButtonProps> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findButton(child, label);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  const element = node as ReactElement<ButtonProps & { children?: ReactNode }>;
  if (element.type === "button" && element.props["aria-label"] === label) return element;
  return findButton(element.props.children, label);
}

function view(overrides: Partial<Parameters<typeof TemplatePickerView>[0]> = {}): string {
  return renderToStaticMarkup(createElement(TemplatePickerView, {
    disabled: false,
    error: null,
    opening: null,
    onOpen: () => {},
    ...overrides,
  }));
}

describe("home templates", () => {
  it("lists the four templates with unique labels", () => {
    expect(TEMPLATES.map((template) => template.id)).toEqual(["budget", "invoice", "tasks", "gradebook"]);
    expect(new Set(TEMPLATES.map((template) => template.label)).size).toBe(TEMPLATES.length);
  });

  it("offers one labelled Open button per template", () => {
    const markup = view();
    expect(markup).toContain("Start from a template");
    for (const template of TEMPLATES) {
      expect(markup).toContain(`aria-label="Open ${template.label} template"`);
      expect(markup).toContain(template.description);
    }
    expect(markup).not.toContain('role="alert"');
  });

  it("disables every Open button while file actions are locked", () => {
    const buttons = view({ disabled: true }).match(/<button[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(TEMPLATES.length);
    expect(buttons.every((button) => button.includes("disabled"))).toBe(true);
  });

  it("opens the invoice template from its button", () => {
    const onOpen = vi.fn();
    const tree = TemplatePickerView({ disabled: false, error: null, opening: null, onOpen });
    findButton(tree, "Open Invoice template")!.props.onClick!();
    expect(onOpen).toHaveBeenCalledWith("invoice");
  });

  it("reports a refused open inline", async () => {
    const refused = vi.fn(async () => { throw new Error("The Budget template is unavailable."); });
    expect(await openTemplateChoice("budget", refused)).toBe("The Budget template is unavailable.");
    const markup = view({ error: "The Budget template is unavailable." });
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("The Budget template is unavailable.");
  });
});
