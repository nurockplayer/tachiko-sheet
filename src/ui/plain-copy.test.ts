import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { API } from "typescript/unstable/sync";
import * as ast from "typescript/unstable/ast";
import { describe, expect, it } from "vitest";

const BANNED = /\b(?:core|runtime|kit|format[- ]2|candidates?|fidelity|ledger|publications?|published|occurrences?|revisions?|witness(?:es)?|projections?|semantic|canonical|authoritative|definition-bearing|portable v1|deduplication|currentness|diagnostics|v1|resident|opaque)\b/i;
const COPY_ATTRIBUTES = new Set(["aria-label", "aria-description", "title", "placeholder", "alt", "label"]);
const root = path.resolve(import.meta.dirname, "../..");

function uiSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? uiSources(file) : /\.tsx?$/.test(file) && !/\.test\./.test(file) ? [file] : [];
  });
}

/** Inspect copy literals, JSX text, template fragments and accessible labels;
 * ignore imports, types, comments, CSS hooks, test IDs and protocol tokens. */
function copyViolations(source: ast.SourceFile): string[] {
  const violations: string[] = [];
  function visit(node: ast.Node, ancestors: ast.Node[]): void {
    if (ast.isJsxText(node) || ast.isStringLiteral(node) || ast.isTemplateLiteralToken(node)) {
      const text = node.text;
      const attribute = ancestors.findLast(ast.isJsxAttribute);
      const isTypeOrImport = ancestors.some((ancestor) => ast.isTypeNode(ancestor) || ast.isImportDeclaration(ancestor) || ast.isExportDeclaration(ancestor) || (ast.isCallExpression(ancestor) && ancestor.expression.kind === ast.SyntaxKind.ImportKeyword));
      const jsxExpression = ancestors.findLast(ast.isJsxExpression);
      const inRenderedExpression = jsxExpression !== undefined && attribute === undefined;
      const attributeIsCopy = attribute !== undefined && COPY_ATTRIBUTES.has(attribute.name.getText(source));
      const parent = ancestors.at(-1);
      const helperValue = parent !== undefined && (ast.isReturnStatement(parent) || ast.isVariableDeclaration(parent) ||
        (ast.isPropertyAssignment(parent) && !["kind", "code", "status"].includes(parent.name.getText(source))));
      const isDataKey = parent !== undefined && ast.isPropertyAssignment(parent) && parent.name === node;
      const ordinary = !isTypeOrImport && !isDataKey && (
        ast.isJsxText(node) || attributeIsCopy || inRenderedExpression || (attribute === undefined && helperValue) ||
        // Includes host-copy objects, error fallbacks and copy helper returns.
        (/\s/.test(text) && (attribute === undefined || attribute.name.getText(source).startsWith("on")))
      );
      // The frozen #146 seed (web-save-closure-current.mjs) requires these
      // exact labels. Allow only their existing SheetShell element contexts;
      // the same words elsewhere remain subject to the ordinary-copy guard.
      const shell = source.fileName === path.join(root, "src/ui/SheetShell.tsx");
      const opening = parent && ast.isJsxElement(parent) ? parent.openingElement : undefined;
      const frozenSaveClosureLabel = shell && (
        (ast.isJsxText(node) && text.trim() === "Import candidate" && opening?.tagName.getText(source) === "button") ||
        (attribute?.name.getText(source) === "aria-label" && ["Source fidelity ledger", "Cross-table summary binding"].includes(text) &&
          parent && ast.isJsxAttribute(parent) && ancestors.some((ancestor) => ast.isJsxOpeningElement(ancestor) && ancestor.tagName.getText(source) === "section"))
      );
      if (ordinary && BANNED.test(text) && !frozenSaveClosureLabel) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        violations.push(`${path.relative(root, source.fileName)}:${line}: ${text.trim()}`);
      }
    }
    node.forEachChild((child) => visit(child, [...ancestors, node]));
  }
  visit(source, []);
  return violations;
}

// Diagnostic/detail allowlist (dynamic producer text, never an ordinary-copy
// exemption): App.describe and SheetShell.explain append error.message after
// "Details:"; importRefusalMessage/importConfirmationMessage do the same.
// fieldDisplay keeps producer diagnostics in tooltips; Summary problems and
// import/export warning lists preserve producer codes/messages verbatim so
// warnings, losses and refusals cannot be hidden by this glossary pass.
// interop-copy keys are exact producer lookup text, never rendered; unknown
// finding messages remain verbatim to preserve unrecognized warnings.
// Runtime/loader/native bridge/storage internals supply those diagnostics;
// their source is not ordinary rendered UI copy. User content is not scanned.
const sources = [
  ...uiSources(path.join(root, "src/ui")),
  ...["App.tsx", "contracts.ts", "main.tsx", "host/host-files.ts", "host/tauri-host-files.ts"]
    .map((file) => path.join(root, "src", file)),
];

describe("plain ordinary UI copy", () => {
  it("keeps implementation vocabulary out of copy sources shared by Web and macOS", () => {
    const api = new API({ cwd: root });
    const config = path.join(root, "tsconfig.json");
    const snapshot = api.updateSnapshot({ openProjects: [config] });
    try {
      const program = snapshot.getProject(config)!.program;
      const violations = sources.flatMap((file) => {
        const source = program.getSourceFile(file);
        expect(source, `copy source must be parsed: ${file}`).toBeDefined();
        return copyViolations(source!);
      });
      expect(violations).toEqual([]);
    } finally {
      snapshot.dispose();
      api.close();
    }
  });

  it("catches JSX, accessible labels and helper/template copy without treating code or details as chrome", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "sheet-plain-copy-"));
    const file = path.join(directory, "copy.tsx");
    writeFileSync(file, `
      import type { Revision } from "./core-kit.js";
      // The core owns canonical state.
      type State = "candidate" | "canonical";
      const hostCopy = { help: "Review the fidelity ledger" };
      function helper() { return \`The runtime is ready for \${name}\`; }
      function singleWord() { return "canonical"; }
      const good = <p className="ts-core" data-testid="revision">Calculated result</p>;
      const bad = <p aria-label="core">Review candidate <span>{"projection"}</span></p>;
      function details(error: Error) { return \`Nothing was imported. (Details: \${error.message})\`; }
    `);
    const api = new API({ cwd: directory });
    const snapshot = api.updateSnapshot({ openFiles: [file] });
    try {
      const source = snapshot.getDefaultProjectForFile(file)!.program.getSourceFile(file)!;
      expect(copyViolations(source).map((violation) => violation.slice(violation.indexOf(": ") + 2)))
        .toEqual(["Review the fidelity ledger", "The runtime is ready for", "canonical", "core", "Review candidate", "projection"]);
    } finally {
      snapshot.dispose();
      api.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

});
