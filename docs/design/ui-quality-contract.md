# Tachiko Sheet UI Quality Contract

Status: proposed Sheet-local guidance under #21; effective after reviewed merge.

This document turns the Notion / modern Excel UI-quality research and its independent review into a concise product contract for Tachiko Sheet. It is **not** a second Tachiko Work Product Constitution, semantic/storage ADR, or authorization to invent capabilities. `UPSTREAM.md`, accepted upstream contracts, `PRODUCT-PRINCIPLES.md`, and `PRODUCT-ACCEPTANCE.md` remain higher authority where they differ.

Completed #13 remains the delivered visual-foundation baseline; #16 remains the physical display / iPad / compact-device qualification owner. This contract guides future visual and interaction changes without reopening either issue.

## North star

**Dense data, quiet chrome, explicit state, stable geometry.**

**Preserve spreadsheet grammar; modernize its presentation.**

Tachiko Sheet is not required to look like Notion or Excel. The research is useful because the two products demonstrate different ways to control visual complexity:

- Notion often removes persistent representation until context makes an action relevant.
- Modern Excel often keeps long-lived spreadsheet structure but lowers its visual competition and improves state/affordance quality.

For Sheet, the target is neither minimalism nor maximum density by itself. The target is predictable, high-throughput spreadsheet work in which only the information that currently deserves attention appears visually dominant.

## 1. Hard product-quality constraints

These are acceptance constraints, not style preferences. Cosmetic improvements cannot compensate for violating them.

### 1.1 Visual priority follows the current task and risk

In ordinary idle workbook work, the worksheet/grid should normally be the primary visual surface and surrounding chrome should be quieter.

That is not a universal ordering. Formula editing, a blocking recovery state, a dangerous confirmation, command search, or an actionable error may legitimately become the dominant layer while that task is active.

Do not hard-code a rule that the grid must always be visually first. The requirement is that the dominant visual signal matches what the user must understand or act on **now**.

### 1.2 Prevent incidental geometry shifts; preserve context during adaptation

With the effective workspace unchanged, hover/focus/selection styling and the appearance of contextual affordances must not unexpectedly change row/column/cell positions or push the user's intended target away. Overlays and reserved slots are possible techniques, not mandatory layouts.

Responsive reflow, window/viewport resizing, browser zoom, opening or resizing a side pane, software-keyboard appearance, and accessibility adaptations may legitimately change workspace geometry. These changes are not limited to spreadsheet data/structure operations and are not failures merely because content moves.

During those adaptations, preserve the selected/edited target and uncommitted draft unless an accepted user operation changes them, maintain truthful focus, and keep the active editor usable, bringing it into view as needed. Necessary panning, scrolling or reflow to continue editing is permitted; context continuity does not require identical pixel coordinates or scroll offsets. #16 retains the physical-platform qualification requirements, including software-keyboard and viewport-change evidence.

### 1.3 State visibility outranks decoration

The product must make these concepts distinguishable when they exist:

- hover;
- keyboard focus;
- active cell / range selection;
- editing;
- drag pickup and valid/invalid destination;
- disabled / unavailable;
- locally queued / started / loading;
- operation outcome: succeeded / failed / unknown;
- error / recovery;
- projection freshness: current / stale / unknown;
- persistence: dirty / saving / saved / failed / unknown.

Do not collapse these concepts into one generic highlight color or one generic grey background. The exact visual channel may differ by component, but the semantics must remain readable.

States may coexist. In particular, keyboard focus is not the same thing as spreadsheet selection, and selection may remain while focus moves to a command surface. Operation outcome, projection freshness and persistence are independent dimensions (§4); one must not be inferred solely from another.

### 1.4 Spreadsheet anchors are functional, not decorative legacy

Grid coordinates, row/column headers, selection boundaries, formula/editing context, sheet navigation, keyboard routes, and other accepted spatial anchors must not be removed merely to achieve a cleaner screenshot.

They may be neutralized, compressed, made contextual, or visually refined when the interaction contract remains clear. Removal requires task evidence, not an aesthetic argument.

### 1.5 Progressive disclosure must preserve access

A capability does not need permanent pixels merely because it exists. Secondary or object-specific actions may move to hover, selection, context menus, overflow, command/search surfaces, or panes.

However:

- critical state/orientation cannot depend on hover;
- a hidden action needs a predictable discoverable path appropriate to supported input modes;
- touch cannot inherit a desktop hover dependency;
- keyboard-first work must remain efficient;
- hiding a control must not silently remove a capability from the supported product path.

The product should hide **representation** when appropriate, not capability.

### 1.6 Command target and scope are explicit

The hard constraint is that the user can determine which cell/range, column, sheet or workbook a command will affect, and execution follows the accepted target-binding and selection contracts. Moving keyboard focus to a command surface must not by itself silently retarget the operation.

A fixed or compact workbook toolbar, command search, shared inspector, or context menu is a valid presentation when the affected scope remains clear and correctly bound. This contract does not require commands to occupy the same physical region as their targets or to be duplicated locally.

**HEURISTIC — prefer proximity when it helps the task.** Object-local commands near their objects, column actions near headers, or sheet actions near navigation may reduce task effort. Evaluate that preference against discoverability, repeated-use efficiency, input modality and expert spatial memory. Proximity is a design preference, not a mandatory physical-placement gate.

### 1.7 Transient UI preserves work context

Menus, popovers, panes, dialogs, help/detail layers, and temporary editing surfaces should preserve the user's working context where logically possible.

Relevant context includes:

- active selection/range;
- usable scroll context (not identical offsets during legitimate adaptation; §1.2);
- edited object and draft;
- keyboard focus/return target;
- current filter/view/sheet;
- current error/recovery scope.

Closing a transient layer should return the user to a predictable place rather than making them reconstruct where they were.

### 1.8 Feedback is truthful and lands near consequence

Pending, saved, failed, unknown, stale, unavailable, and current states must not be visually conflated. Semantic publication, projection freshness and durable persistence require their respective evidence under existing runtime/host contracts; a success indication for one does not establish the others.

When a change affects the grid, the grid/object should carry the primary consequence feedback when practical. Global toast/status messaging may supplement local feedback but should not be the only indication of a cell/range-local error or change.

Existing authority around currentness, save/recovery truthfulness, and canonical state is unchanged. UI polish must never convert uncertainty into apparent success.

### 1.9 Accessibility and input modality are first-order constraints

Accessibility is not a final polish pass. Every material UI change must preserve or improve the relevant path from the start.

At minimum, applicable work must account for:

- visible keyboard focus and predictable focus order;
- real keyboard spreadsheet workflows, not only synthetic clicks;
- CJK IME composition/draft behavior;
- sufficient contrast and forced/high-contrast behavior;
- reduced-motion preferences;
- pointer hit areas and drag/resize affordances;
- touch-specific interaction where touch is in the supported claim;
- no critical capability that exists only on hover.

Platform qualification still belongs to the appropriate acceptance owner; this rule prevents architecture that makes those paths impossible later.

### 1.10 Shared components have one behavioral grammar

A shared button, menu item, tab, field, popover, dialog, tooltip, pane header, sheet tab, or other repeated primitive must behave predictably across features.

The same semantic action should not arbitrarily change icon, label, danger placement, focus behavior, hover behavior, or dismissal rules from one feature to another.

Consistency does not require every component to look identical. It requires the same meaning to produce the same interaction expectations.

## 2. Application chrome and worksheet content are different systems

Application chrome and user-authored worksheet formatting must not be conflated.

The Sheet UI foundation should use a small semantic system for application controls. A user's workbook may legitimately contain many fonts, fills, borders, number styles, colors, and layout choices because those are user data/presentation semantics.

Do not use “the app has a small type ramp” as a reason to restrict worksheet formatting. Conversely, do not let arbitrary worksheet formatting leak into application chrome.

## 3. Semantic design-token boundary

The design system should define semantic families rather than copy screenshot-derived Notion values or Fluent/Excel reference numbers.

Required families include, as the product needs them:

- **surface roles** — work canvas, quiet chrome, raised/local panel, transient overlay, selected/active-navigation surfaces;
- **text roles** — primary, secondary, tertiary/metadata, disabled, danger/status, code/numeric where needed;
- **line/boundary roles** — gridline, divider, input boundary, selection, focus, error/warning;
- **state roles** — hover, pressed, selected, editing, drag target, local progress, operation outcome, projection freshness, persistence status, error/recovery; outcome, freshness and persistence remain independent;
- **spacing families** — a finite repeated rhythm for inline, control-internal, group, and section spacing;
- **control geometry** — repeated control/row families appropriate to density/input mode;
- **radius/elevation roles** — tied to semantic container/layer roles rather than feature-local decoration;
- **icon grammar** — shared family, optical alignment, semantic mapping, selected/filled policy where useful;
- **motion roles** — small set of transition categories whose purpose is state/layer/continuity, not decoration.

Exact token values are implementation decisions until measured and accepted. Research-estimated Notion sizes/timings and Fluent design-system reference values must not be relabeled as Tachiko or Excel/Notion product facts.

Existing `--ts-*` values are implementation, not independent product authority; they may evolve while preserving this contract and accepted behavior.

## 4. Interaction-state contract

For every shared interactive primitive, define only the states that semantically exist, but derive them from a common grammar.

| State or dimension | Required property |
| --- | --- |
| Rest | Quiet enough not to compete with the current task unless the control itself is primary. |
| Hover | Confirms target/action without incidental geometry shift (§1.2); not the only path to critical capability. |
| Focus | Clearly visible for keyboard use and distinguishable from hover/selection. |
| Pressed/active | Gives immediate input acknowledgement without falsely implying completion. |
| Selected | Represents persistent object/range/tab selection and remains distinguishable from transient hover. |
| Editing | Clearly different from selected-but-not-editing; typing consequences are unambiguous. |
| Dragging | Shows pickup plus valid/invalid destination before commit. |
| Disabled/unavailable | Readable and recognizably unavailable; explain reason/recovery where material. |
| Pending/loading | Shows that an operation has been locally queued/started, or that content is loading, but is not complete. This indication alone does not prove authoritative runtime acceptance, semantic publication, projection currentness or durable save. |
| Error/recovery | Attached to the relevant context where practical and provides a recovery path. |
| Operation outcome | Report confirmed success/failure for the specific operation under the existing runtime/host contract; completion alone is not success. A historical success is not proof that the displayed workbook is current or that its latest work is durably saved. Uncertain outcomes remain unknown. |
| Projection freshness | Show current/stale/unknown for displayed data using existing occurrence/revision-qualified authority, independently of operation outcome and persistence. A success badge alone cannot establish currentness. |
| Persistence | Show dirty/saving/saved/failed/unknown from existing host/durable-save evidence for the relevant work, independently of publication and freshness. A successful save of an older revision must not mark newer work saved or clear its dirty state. |

This is not a linear state machine. Multiple state dimensions may coexist and tests should cover material combinations.

In particular, check confirmed semantic publication with a current projection while Save is pending or failed; a successful save of an older revision while newer work remains dirty; and local-queue or unknown-outcome indications without publication evidence. A save result does not establish freshness of the currently displayed projection. Apply existing occurrence/revision and save contracts; this table introduces no new canonical state or storage semantics.

## 5. Density and responsive/input adaptation

There is no single universally correct density.

For high-density spreadsheet work:

- preserve useful simultaneous data visibility;
- lower unnecessary decoration before enlarging every cell/control;
- keep the grid highly regular even when dense;
- let command chrome compress/collapse where the product still remains discoverable;
- allow pointer and touch modes to use different target sizes/spacing without changing the meaning of the command;
- re-map interaction primitives across mouse/keyboard/touch rather than simply scaling the desktop layout.

A touch adaptation may use larger invisible hit areas, different menus, different toolbar placement, or different disclosure. It must not make row/column/range meaning less truthful merely to look spacious.

## 6. Borders, surfaces, radius, shadow, and motion

None of these is a goal by itself.

Use them only when they communicate a job:

- **border/divider** — real boundary, editable control boundary, selection/focus, or meaningful separation;
- **surface change** — grouping, selection/active-navigation state, or chrome/work-area distinction;
- **radius** — consistent geometry vocabulary for a semantic container family;
- **shadow/elevation** — temporary layer relationship, not “modern” decoration for every card;
- **motion** — state/layer/spatial continuity and feedback; it must not delay high-frequency work or create false hierarchy.

A design is not more modern merely because it has fewer borders or more rounded corners. Removing an affordance that users need is a regression.

## 7. Acceptance model

Do not use one aggregate UI-quality or “modernity” score in which cosmetic wins can offset broken interaction, state truth, focus, or accessibility.

Review through three separate tracks.

### 7.1 Blocking interaction / trust gates

Applicable changes must not introduce:

- selection/edit/focus or command-scope ambiguity that can cause the wrong operation target;
- incidental hover/focus/contextual-affordance shifts that disrupt target acquisition; legitimate workspace adaptation is governed by §1.2;
- lost working target, draft, focus continuity or usable scroll context across transient UI or workspace adaptation; necessary scrolling/reflow to keep the editor usable is not itself context loss;
- false operation-success, projection-currentness or durable-save claims without evidence for that specific dimension, including marking newer work saved from an older successful save; legitimate combinations such as current data with a failed Save must remain representable (§4);
- inaccessible core paths for the supported keyboard/pointer/touch claim;
- hidden critical state with no non-hover path;
- drag/resize/insert interaction whose destination is unknowable before commit;
- critical errors communicated only by a transient global toast;
- semantic/runtime behavior fabricated in the client to make the UI look complete.

A blocking failure is not offset by stronger visual consistency elsewhere.

### 7.2 Visual-system consistency review

Review at least:

- task-appropriate hierarchy in idle and active states;
- typography roles and baseline alignment;
- finite/repeated spacing and control families;
- icon family and semantic consistency;
- borders/surfaces/elevation used by role rather than feature whim;
- hover/focus/selected/editing/error treatments derived from one grammar;
- quiet ordinary chrome without erasing necessary spreadsheet anchors;
- realistic populated worksheets, not only empty/demo screens.

### 7.3 Human interaction / perceived-quality review

Static screenshot review is insufficient.

Use representative normal-product tasks that include dense content and state transitions: navigate/select, edit, open contextual UI, invoke a command, handle pending/error/recovery, save/reopen where applicable, and repeat work with keyboard and the relevant pointer/touch mode.

The reviewer should evaluate whether the product is clear, stable, predictable, and mature during use—not merely whether it resembles a reference product.

## 8. Evidence discipline

Visual/interaction evidence follows the existing #13 / #16 discipline. Record enough context to make a result reproducible, including as applicable:

- exact Sheet commit/artifact;
- platform/OS/browser/host identity;
- viewport or actual CSS workspace;
- display/scaling/DPR where relevant;
- browser zoom;
- theme / forced-colors / reduced-motion state where relevant;
- input mode;
- scenario/state being shown or tested.

Reference screenshots are evidence of a specific build/state, not a substitute for executable or human interaction acceptance.

## 9. Evidence labels for numbers and claims

Whenever a design rule uses a numeric value or external-product claim, classify it clearly:

- **REQUIRED** — accepted Tachiko product/accessibility requirement;
- **REFERENCE** — external design-system or platform guidance used as a benchmark;
- **MEASURED** — measured from a recorded Tachiko build/environment;
- **ESTIMATED** — visually inferred from external product material;
- **HEURISTIC** — proposed product guideline that still needs evidence/calibration.

Do not silently promote ESTIMATED, REFERENCE, or HEURISTIC values into REQUIRED acceptance criteria.

Examples such as “90% of spacing values must map to tokens,” “common actions must be within two menu layers,” or screenshot-derived Notion animation durations are heuristics unless Tachiko separately accepts them with evidence.

## 10. Preferred modernization order

When a future surface looks old or internally assembled, prefer this order of work:

1. verify task hierarchy and state truth;
2. verify keyboard/focus/accessibility/input paths;
3. remove component/behavioral inconsistency;
4. reduce unnecessary chrome salience without removing required anchors;
5. modernize grid-specific affordances and feedback;
6. introduce contextual disclosure where it preserves discoverability;
7. normalize semantic token families and optical alignment;
8. adapt density/interaction to supported input modes;
9. then polish motion, elevation, and remaining optical details.

This is a dependency order, not evidence that one item contributes a fixed percentage of perceived quality.

## 11. Non-goals

This contract does not require or authorize:

- a Notion visual clone;
- an Excel pixel clone or full Ribbon recreation;
- reducing spreadsheet data density to document-editor density;
- hiding all persistent controls;
- removing borders solely for aesthetics;
- a universal 4px/8px spacing law, radius value, font size, or motion duration copied from another product;
- a universal cross-product Tachiko design platform before actual multi-product pressure exists;
- frontend semantic/calculation/storage authority;
- new spreadsheet behavior added only to make screenshots look complete.

The enduring product rule is simpler:

> **Keep necessary information dense; make unnecessary visual competition sparse. Preserve the working target, uncommitted drafts, semantic context, interaction continuity and trust through legitimate workspace adaptation (§1.2), rather than requiring fixed pixel positions or scroll offsets.**
