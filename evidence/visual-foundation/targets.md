# #13 annotated target compositions

Pinned target revision: `7e1c12296690cf92779c01f13bd3c6256260b47e` (baseline capture)

These compact wireframes are the reviewable target compositions for the visual
foundation. They describe the intended arrangement of the real current runtime;
they do not introduce new application states or controls.

## 1. Home

```text
┌ Tachiko Sheet ─────────────────────────────────────────────────────────────┐
│ Open a project folder, or reopen a copy saved in this browser profile.      │
│ ┌ Open project ──────────────────────────┐  ┌ Saved copies ───────────────┐ │
│ │ Open project folder  [Choose folder]   │  │ Stored on this device        │ │
│ │ [Try example]                         │  │ No saved copies yet.         │ │
│ └────────────────────────────────────────┘  └──────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────┘
```

Annotation: open work is the primary action; saved copies remain discoverable
without becoming navigation. Dense spacing and a wide frame preserve room for
CJK labels at narrow widths.

## 2. Populated Workbook

```text
┌ Plan                                      Current  Not saved  No pending op ┐
│ release_items · 8 rows · revision rev-1     [Refresh] [Save a copy] [Close] │
│ [Table]  Brief                                                           │
│ Row │ title             │ impact │ priority │ notes                         │
│ 01  │ Launch checklist  │ 5      │ 10       │ Confirm owner                 │
│ 02  │ Partner review    │ 3      │  —       │ …                             │
└────────────────────────────────────────────────────────────────────────────┘
```

Annotation: the grid is the primary canvas; status and consequence-bearing
actions share one calm header. The existing Table/Brief views remain the only
views and all values come from the runtime projection.

## 3. Active edit / selection

```text
│ Row │ title             │ impact │ priority │
│ 01  │ Launch checklist  │ [ 5              ]  ← selected, inline editor
│     └──────────── strong 3px focus ring + keyboard-visible context
```

Annotation: one cell has an unambiguous selection/focus treatment and the
existing inline input stays in place. Arrow, Tab, Enter, F2, Escape, and IME
composition behaviour are unchanged.

## 4. Command / save dialog

```text
                 ┌ Save a copy ───────────────────┐
                 │ Creates a new copy in this      │
                 │ browser profile.                 │
                 │ Copy name                        │
                 │ [____________________________]  │
                 │                 [Cancel] [Create copy] │
                 └─────────────────────────────────┘
```

Annotation: the existing modal is the only command overlay. Contrast, clear
device-local wording, Escape handling, and focus trapping make the consequence
of the action explicit.

## 5. Error / recovery

```text
┌ The current work could not be confirmed. Its freshness stays unknown.       │
│ Recovery required; freshness unconfirmed       Freshness unknown  Outcome ? │
│ Resident work is not confirmed. Refresh to re-read it.       [Refresh]       │
```

Annotation: exception state is visually distinct and actionable. No stale grid
is rendered as editable; ordinary warning, failed save, and unknown freshness
retain separate meanings.

## Brief / overlay state board

| Runtime state | Presentation treatment | Interaction contract |
|---|---|---|
| Current | neutral status chip; normal grid | existing controls enabled |
| Pending / applying | amber status and concise lock note | editing and conflicting actions disabled |
| Saved on device | green confirmation chip | receipt remains tied to revision |
| Save failed | red actionable status/message | retry remains an explicit user action |
| Freshness unknown | amber blocking recovery card/banner | Refresh is available; open/edit routes locked |
| Calculation failure | warning tone at cell, explicit text/title | no frontend interpretation of formula |
| Unavailable / not loaded | muted cell tone, explicit label | no fabricated value or control |
| Focus / selected | 3px blue outline and selected-row context | keyboard navigation remains native and visible |

Responsive checks: 1440×900, 1024×768, 375×812; 100% and 200% zoom; CJK
strings; keyboard-only focus; `prefers-reduced-motion`; and `forced-colors`.
