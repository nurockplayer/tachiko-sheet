//! The grid canary's Rust UI: a synthetic rows x columns grid.
//!
//! A throwaway evidence app for Sheet #327, split out of the spike's
//! `prototypes/nsh-spike` (`origin/ds/nsh-spike`). One screen, no tabs.

use std::collections::HashMap;

use nsh_base::{
    DataTable, DataTableApi, DataTableCell, DataTableColumn, DataTableRange, DataTableRows,
    DataTableSelection, DataTableTarget, data_table, input, theme,
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
}

fn grid_screen(state: GridState) -> impl IntoElement {
    let rows = move || grid_rows(state.window.get(), &state.edits.get(), state.columns);
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
                .flex_1()
                .test_id("grid-wrap")
                .child(
                    data_table()
                        .component_ref(&state.table)
                        .flex_1()
                        .columns(grid_columns(state.columns))
                        .row_count(state.rows)
                        .data_start(move || state.window.get().start)
                        .data(rows)
                        .row_height(px(24.0))
                        .cell_selectable(true)
                        .row_header(true)
                        .loop_selection(false)
                        .render_cell(move |cell: &DataTableCell| {
                            let (row, column) = (cell.row, cell.column);
                            let is_editing = move || state.editing.get() == Some((row, column));
                            view()
                                .flex_1()
                                .child(text(cell.text.clone()))
                                .child(when(is_editing, move || {
                                    view()
                                        .w(px(1.0))
                                        .h(px(1.0))
                                        .element_ref(&state.marker)
                                }))
                        })
                        .on_visible_rows_change(move |range: &DataTableRange| {
                            state.on_visible_rows(range);
                        })
                        .on_selection_change(move |selection: &Option<DataTableSelection>| {
                            state.on_selection(selection);
                        })
                        .on_double_press(move |target: &DataTableTarget| {
                            if let (Some(row), Some(column)) = (target.row, target.column) {
                                state.begin_edit(row, column);
                            }
                        }),
                ),
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
