//! The grid canary's Rust UI: a synthetic rows x columns grid.
//!
//! A throwaway evidence app for Sheet #327, split out of the spike's
//! `prototypes/nsh-spike` (`origin/ds/nsh-spike`). One screen, no tabs.

use std::collections::HashMap;

use nsh_base::{
    DataTable, DataTableApi, DataTableCell, DataTableColumn, DataTablePress, DataTableRange,
    DataTableRows, DataTableSelection, DataTableTarget, data_table, input, theme,
};
use nsh_core::prelude::*;

/// The app's UI set (`nsh.json` `"rust"`): what a TSX entry may import from
/// `nsh-grid/native`.
#[native_module("nsh-grid/native")]
fn native(registry: &mut Registry) {
    registry.register::<App>();
}

/// 10,000 x 30 by default; `NSH_GRID_SIZE=100k` gives 100,000 x 50.
fn grid_size() -> (u32, u32) {
    match std::env::var("NSH_GRID_SIZE").as_deref() {
        Ok("100k") => (100_000, 50),
        _ => (10_000, 30),
    }
}

/// The application's root component.
#[component]
pub fn App() -> impl IntoElement {
    let grid_state = GridState::new();
    // Grid keyboard navigation: arrows move the focus cell; with Shift they
    // grow the range instead of collapsing it (slice 1b).
    let keys = grid_state;
    on_key("up", move |_| keys.move_focus(-1, 0, false));
    on_key("down", move |_| keys.move_focus(1, 0, false));
    on_key("left", move |_| keys.move_focus(0, -1, false));
    on_key("right", move |_| keys.move_focus(0, 1, false));
    on_key("shift+up", move |_| keys.move_focus(-1, 0, true));
    on_key("shift+down", move |_| keys.move_focus(1, 0, true));
    on_key("shift+left", move |_| keys.move_focus(0, -1, true));
    on_key("shift+right", move |_| keys.move_focus(0, 1, true));
    view()
        .flex_1()
        .bg(move || theme().background)
        .text_color(move || theme().foreground)
        .child(grid_screen(grid_state))
}

fn button(
    id: &'static str,
    label: &'static str,
    on_press: impl Fn() + 'static,
) -> impl IntoElement {
    view()
        .test_id(id)
        .px_3()
        .py_2()
        .rounded(px(8.0))
        .bg(move || theme().secondary)
        .active(|s| s.opacity(0.6))
        .on_press(on_press)
        .child(
            text(label)
                .text_size(px(14.0))
                .text_color(move || theme().secondary_foreground),
        )
}

// ---------------------------------------------------------------------------
// The grid screen: synthetic cells, computed on demand.
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, PartialEq)]
struct GridWindow {
    start: u32,
    end: u32,
}

#[derive(Clone, Copy)]
struct GridState {
    rows: u32,
    columns: u32,
    window: Signal<GridWindow>,
    edits: Signal<HashMap<(u32, u32), String>>,
    editing: Signal<Option<(u32, u32)>>,
    editor: Signal<String>,
    status: Signal<String>,
    selection: Signal<Option<(u32, u32)>>,
    /// The corner a selection drag or a Shift press grew the range from.
    anchor: Signal<Option<(u32, u32)>>,
    /// The cell a selection drag or an arrow key moved to.
    focus: Signal<Option<(u32, u32)>>,
    /// The left button is held and a drag is growing the range.
    dragging: Signal<bool>,
    /// The table's reported first visible row and column, unpadded.
    first_row: Signal<u32>,
    first_col: Signal<u32>,
    marker: ElementRef,
    table: ComponentRef<DataTable>,
}

impl GridState {
    fn new() -> Self {
        let (rows, columns) = grid_size();
        Self {
            rows,
            columns,
            window: signal(GridWindow { start: 0, end: 40 }),
            edits: signal(HashMap::new()),
            editing: signal(None),
            editor: signal(String::new()),
            status: signal(format!(
                "grid {rows} x {columns} last R{}C{}",
                rows - 1,
                columns - 1
            )),
            selection: signal(None),
            anchor: signal(None),
            focus: signal(None),
            dragging: signal(false),
            first_row: signal(0),
            first_col: signal(0),
            marker: element_ref(),
            table: component_ref::<DataTable>(),
        }
    }

    fn begin_edit(&self, row: u32, column: u32) {
        self.editing.set(Some((row, column)));
        self.editor.set(grid_text(row, column, &self.edits.get()));
        self.status.set(format!("editing R{row}C{column}"));
    }

    fn commit(&self) {
        let Some((row, column)) = self.editing.get() else {
            self.status.set(String::from("no cell is being edited"));
            return;
        };
        let text = self.editor.get();
        self.edits
            .update(|edits| {
                edits.insert((row, column), text.clone());
            });
        self.editing.set(None);
        self.status.set(format!("edited R{row}C{column} = {text}"));
    }

    /// Scroll to the last cell: the deep end of both axes in one press.
    fn jump_last(&self) {
        let row = self.rows - 1;
        let column = self.columns - 1;
        self.window.set(GridWindow {
            start: row.saturating_sub(12),
            end: self.rows,
        });
        let mut selection = DataTableSelection::default();
        selection.row = Some(row);
        selection.column = Some(column);
        self.selection.set(Some((row, column)));
        self.begin_edit(row, column);
        if let Some(api) = self.table.api::<DataTableApi>() {
            api.select(Some(selection));
            api.scroll_to_row(row, Some(false));
            api.scroll_to_column(format!("c{column}"), Some(false));
        }
        self.status.set(format!("jumped to R{row}C{column}"));
    }

    fn on_visible_rows(&self, range: &DataTableRange) {
        self.first_row.set(range.start);
        self.window.set(GridWindow {
            start: range.start.saturating_sub(2),
            end: (range.end + 2).min(self.rows),
        });
    }

    fn on_selection(&self, selection: &Option<DataTableSelection>) {
        let Some(selection) = *selection else { return };
        let (Some(row), Some(column)) = (selection.row, selection.column) else {
            return;
        };
        self.selection.set(Some((row, column)));
        self.editor.set(grid_text(row, column, &self.edits.get()));
    }

    fn on_visible_columns(&self, range: &DataTableRange) {
        self.first_col.set(range.start);
    }

    /// The cell `position` (relative to `grid-wrap`) is over, clamped to the
    /// table: a 24 pt title row, 24 pt rows, 90 pt columns, c0 fixed.
    fn cell_at(&self, position: Point<Points>) -> (u32, u32) {
        let x = position.x.0;
        let y = position.y.0;
        let row = self.first_row.get() as i64 + ((y - 24.0) / 24.0).floor() as i64;
        let column = if x < 90.0 {
            0
        } else {
            self.first_col.get() as i64 + ((x - 90.0) / 90.0).floor() as i64
        };
        (
            row.clamp(0, self.rows as i64 - 1) as u32,
            column.clamp(0, self.columns as i64 - 1) as u32,
        )
    }

    /// The drag moved the pointer to `position` with the left button held.
    fn on_drag(&self, position: Point<Points>) {
        let cell = self.cell_at(position);
        if !self.dragging.get() {
            self.dragging.set(true);
            self.anchor.set(Some(cell));
        }
        self.focus.set(Some(cell));
    }

    /// A press of a cell: plain sets the range to it, Shift grows it.
    fn on_press(&self, cell: (u32, u32), shift: bool) {
        self.focus.set(Some(cell));
        if !shift {
            self.anchor.set(Some(cell));
        }
    }

    /// Moves by `(d_row, d_col)` from the active cell (the anchor's when the
    /// range grows, the focus cell's when a plain key collapses it).
    fn move_focus(&self, d_row: i64, d_col: i64, shift: bool) {
        let from = if shift {
            self.focus.get().or(self.anchor.get())
        } else {
            self.anchor.get().or(self.focus.get())
        };
        let Some((row, column)) = from else {
            return;
        };
        let row = (row as i64 + d_row).clamp(0, self.rows as i64 - 1) as u32;
        let column = (column as i64 + d_col).clamp(0, self.columns as i64 - 1) as u32;
        self.on_press((row, column), shift);
        if let Some(api) = self.table.api::<DataTableApi>() {
            api.scroll_to_row(row, Some(false));
            api.scroll_to_column(format!("c{column}"), Some(false));
            let mut selection = DataTableSelection::default();
            selection.row = Some(row);
            selection.column = Some(column);
            api.select(Some(selection));
        }
    }
}

/// `range R<r1>C<c1>:R<r2>C<c2>`, top-left then bottom-right, for the
/// test-read status line.
fn range_text(anchor: Option<(u32, u32)>, focus: Option<(u32, u32)>) -> String {
    let (Some(anchor), Some(focus)) = (anchor, focus) else {
        return String::from("range none");
    };
    format!(
        "range R{}C{}:R{}C{}",
        anchor.0.min(focus.0),
        anchor.1.min(focus.1),
        anchor.0.max(focus.0),
        anchor.1.max(focus.1)
    )
}

fn grid_screen(state: GridState) -> impl IntoElement {
    let rows = move || grid_rows(state.window.get(), &state.edits.get(), state.columns);
    // `NSH_GRID_PLAIN=1` leaves the cells to DataTable's own text, with no
    // per-cell view and no range tint, for the plain-vs-cells sweep run.
    let plain = std::env::var_os("NSH_GRID_PLAIN").is_some();
    let table = data_table()
        .component_ref(&state.table)
        .flex_1()
        .columns(grid_columns(state.columns))
        .row_count(state.rows)
        .data_start(move || state.window.get().start)
        .data(rows)
        .row_height(px(24.0))
        .cell_selectable(true)
        // The app cannot measure the row numbers' width.
        .row_header(false)
        // The app keeps its own range on a modifier press.
        .select_on_modifier_press(false)
        .loop_selection(false)
        .on_row_press(move |p: &DataTablePress| {
            state.on_press((p.row, p.column.unwrap_or(0)), p.shift);
        })
        .on_visible_rows_change(move |range: &DataTableRange| {
            state.on_visible_rows(range);
        })
        .on_visible_columns_change(move |range: &DataTableRange| {
            state.on_visible_columns(range);
        })
        .on_selection_change(move |selection: &Option<DataTableSelection>| {
            state.on_selection(selection);
        })
        .on_double_press(move |target: &DataTableTarget| {
            if let (Some(row), Some(column)) = (target.row, target.column) {
                state.begin_edit(row, column);
            }
        });
    let table = if plain {
        table
    } else {
        table.render_cell(move |cell: &DataTableCell| {
            let (row, column) = (cell.row, cell.column);
            let is_editing = move || state.editing.get() == Some((row, column));
            let in_range = move || {
                let (Some(anchor), Some(focus)) = (state.anchor.get(), state.focus.get()) else {
                    return false;
                };
                (anchor.0.min(focus.0)..=anchor.0.max(focus.0)).contains(&row)
                    && (anchor.1.min(focus.1)..=anchor.1.max(focus.1)).contains(&column)
            };
            view()
                .flex_1()
                .bg(move || {
                    if in_range() {
                        theme().secondary
                    } else {
                        theme().background
                    }
                })
                .child(text(cell.text.clone()))
                .child(when(is_editing, move || {
                    view()
                        .w(px(1.0))
                        .h(px(1.0))
                        .element_ref(&state.marker)
                }))
        })
    };
    view()
        .flex_1()
        .gap_2()
        .p_4()
        .child(
            view()
                .flex_row()
                .gap_2()
                .items_center()
                .child(button("jump-last", "Jump to last", move || {
                    state.jump_last();
                }))
                .child(
                    input()
                        .test_id("grid-editor")
                        .w(px(200.0))
                        .value(move || state.editor.get())
                        .on_change(move |text: &str| state.editor.set(text.to_owned())),
                )
                .child(button("grid-commit", "Commit grid cell", move || {
                    state.commit();
                }))
                .child(button("select-b2", "B2", move || {
                    state.on_press((2, 1), false);
                })),
        )
        // On its own line: the test surface is phone-sized (390 pt wide), and
        // in the row above the status is pushed outside the window and so off
        // screen, where `app.texts()` cannot read it.
        .child(
            view()
                .test_id("grid-status")
                .child(text(move || state.status.get()).text_size(px(13.0))),
        )
        .child(
            view()
                .test_id("grid-range")
                .child(
                    text(move || range_text(state.anchor.get(), state.focus.get()))
                        .text_size(px(13.0)),
                ),
        )
        .child(
            view()
                .test_id("grid-first")
                .child(
                    text(move || {
                        format!(
                            "first R{}C{}",
                            state.first_row.get(),
                            state.first_col.get()
                        )
                    })
                    .text_size(px(13.0)),
                ),
        )
        .child(
            view()
                .flex_1()
                .test_id("grid-wrap")
                .on_mouse_move(move |e: &MouseEvent| {
                    if e.pressed_button == Some(MouseButton::Left) {
                        state.on_drag(e.position);
                    } else if state.dragging.get() {
                        state.dragging.set(false);
                    }
                })
                .child(table),
        )
        .child(
            when(move || state.editing.get().is_some(), move || {
                overlay()
                    .anchor(&state.marker)
                    .placement(Placement::Bottom)
                    .offset(px(4.0))
                    .child(
                        view()
                            .flex_row()
                            .gap_2()
                            .items_center()
                            .p_2()
                            .bg(move || theme().popover)
                            .border_1()
                            .border_color(move || theme().border)
                            .rounded(px(8.0))
                            .child(
                                input()
                                    .test_id("cell-editor")
                                    .w(px(200.0))
                                    .auto_focus(true)
                                    .value(move || state.editor.get())
                                    .on_change(move |text: &str| state.editor.set(text.to_owned()))
                                    .on_submit(move |_text: &str| state.commit()),
                            )
                            .child(button("overlay-commit", "Commit", move || state.commit())),
                    )
            }),
        )
}

fn grid_text(row: u32, column: u32, edits: &HashMap<(u32, u32), String>) -> String {
    edits
        .get(&(row, column))
        .cloned()
        .unwrap_or_else(|| format!("R{row}C{column}"))
}

fn grid_rows(window: GridWindow, edits: &HashMap<(u32, u32), String>, columns: u32) -> DataTableRows {
    let len = window.end.saturating_sub(window.start) as usize;
    let mut rows = DataTableRows::new(len);
    for column in 0..columns {
        let key = format!("c{column}");
        rows = rows.texts(
            &key,
            (window.start..window.end).map(|row| grid_text(row, column, edits)),
        );
    }
    rows
}

fn grid_columns(columns: u32) -> Vec<DataTableColumn> {
    (0..columns)
        .map(|column| {
            let mut result = DataTableColumn::default();
            result.key = format!("c{column}").into();
            result.title = Some(format!("C{column}").into());
            result.width = Some(px(90.0));
            result.fixed = column == 0;
            result
        })
        .collect()
}
