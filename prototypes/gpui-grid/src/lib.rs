//! Throwaway canary for Sheet #327: can GPUI Kit's `DataTable` host
//! spreadsheet range selection with less workaround than NSH's `DataTable`?
//!
//! The grid has no stored cells: text is derived from the row and column
//! index, and the only mutable state is [`RangeState`]. Selection is driven
//! by the table's own per-cell pointer events, so there is no pixel math.

use std::collections::HashMap;

use gpui_kit::base::actions::{Cancel, SelectNextColumn};
use gpui_kit::component::{
    ActiveTheme as _, Sizable as _, Size as ComponentSize,
    input::{Input, InputState},
    table::{Column, DataTable, TableDelegate, TableEvent, TableState},
};
use gpui_kit::*;

/// The number of rows and columns for a run.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct GridSize {
    pub rows: usize,
    pub cols: usize,
}

impl GridSize {
    /// `100k` is 100,000 x 50; anything else is 10,000 x 30.
    pub fn from_env() -> Self {
        match std::env::var("GPUI_GRID_SIZE").as_deref() {
            Ok("100k") => Self {
                rows: 100_000,
                cols: 50,
            },
            _ => Self {
                rows: 10_000,
                cols: 30,
            },
        }
    }
}

/// The current range selection.
///
/// `anchor` is where the gesture started, `focus` is the cell the pointer or
/// keyboard last reached. Both are `None` until the first press.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct RangeState {
    pub anchor: Option<(usize, usize)>,
    pub focus: Option<(usize, usize)>,
    pub dragging: bool,
    /// Set when a drag ended on more than one cell; the trailing
    /// `TableEvent::SelectCell` from the table's click handler is ignored once.
    pub suppress_next_select: bool,
}

impl RangeState {
    /// A press selects one cell; with Shift held it only moves the focus.
    pub fn press(&mut self, row: usize, col: usize, shift: bool) {
        self.suppress_next_select = false;
        if shift {
            self.focus = Some((row, col));
        } else {
            self.anchor = Some((row, col));
            self.focus = Some((row, col));
        }
        self.dragging = true;
    }

    /// Move the focus while the button is held.
    pub fn drag_to(&mut self, row: usize, col: usize) {
        if self.dragging {
            self.focus = Some((row, col));
        }
    }

    /// The button was released.
    pub fn release(&mut self) {
        if self.dragging && self.normalized().map_or(false, |(a, b)| a != b) {
            self.suppress_next_select = true;
        }
        self.dragging = false;
    }

    /// The selected corners, ordered top-left then bottom-right.
    pub fn normalized(&self) -> Option<((usize, usize), (usize, usize))> {
        let (a, f) = (self.anchor?, self.focus?);
        Some(((a.0.min(f.0), a.1.min(f.1)), (a.0.max(f.0), a.1.max(f.1))))
    }

    /// `R{r1}C{c1}:R{r2}C{c2}`, or `None` before the first press.
    pub fn label(&self) -> Option<String> {
        let (a, b) = self.normalized()?;
        Some(format!("R{}C{}:R{}C{}", a.0, a.1, b.0, b.1))
    }

    /// Whether the cell is inside the range.
    pub fn contains(&self, row: usize, col: usize) -> bool {
        self.normalized()
            .map_or(false, |(a, b)| row >= a.0 && row <= b.0 && col >= a.1 && col <= b.1)
    }
}

/// The grid: sizes only, plus the range state. No cell is stored.
pub struct GridDelegate {
    size: GridSize,
    columns: Vec<Column>,
    pub range: RangeState,
    pub edits: HashMap<(usize, usize), String>,
    pub editing: Option<(usize, usize)>,
    pub editor: Option<Entity<InputState>>,
}

impl GridDelegate {
    pub fn new(size: GridSize) -> Self {
        let columns = (0..size.cols)
            .map(|col_ix| {
                let mut column =
                    Column::new(format!("col-{col_ix}"), format!("C{col_ix}")).width(px(90.));
                if col_ix == 0 {
                    column = column.fixed_left();
                }
                column
            })
            .collect();
        Self {
            size,
            columns,
            range: RangeState::default(),
            edits: HashMap::new(),
            editing: None,
            editor: None,
        }
    }

    /// The editor element is shared by the app and the delegate; the delegate
    /// only mounts it inside the editing cell.
    pub fn with_editor(mut self, editor: Entity<InputState>) -> Self {
        self.editor = Some(editor);
        self
    }

    pub fn size(&self) -> GridSize {
        self.size
    }

    /// The edited value if the cell has one, otherwise its default label.
    pub fn cell_text(&self, row: usize, col: usize) -> String {
        self.edits
            .get(&(row, col))
            .cloned()
            .unwrap_or_else(|| format!("R{row}C{col}"))
    }

    /// The cell whose editor is mounted, if any.
    pub fn editing(&self) -> Option<(usize, usize)> {
        self.editing
    }
}

impl TableDelegate for GridDelegate {
    fn columns_count(&self, _: &App) -> usize {
        self.size.cols
    }

    fn rows_count(&self, _: &App) -> usize {
        self.size.rows
    }

    fn column(&self, col_ix: usize, _: &App) -> Column {
        self.columns[col_ix].clone()
    }

    fn render_td(
        &mut self,
        row_ix: usize,
        col_ix: usize,
        _window: &mut Window,
        cx: &mut Context<TableState<Self>>,
    ) -> impl IntoElement {
        let inside = self.range.contains(row_ix, col_ix);
        let tint = cx.theme().tokens.table_active;
        let text = self.cell_text(row_ix, col_ix);
        let editor = self.editor.clone();
        let editing = self.editing == Some((row_ix, col_ix));

        let mut cell = div()
            .id(format!("grid-cell:{row_ix}:{col_ix}"))
            .size_full()
            .px_1();
        if inside {
            cell = cell.bg(tint);
        }

        if editing {
            if let Some(editor) = editor {
                return cell.child(Input::new(&editor).id("cell-editor"));
            }
        }

        let entity = cx.entity();
        let drag_entity = entity.clone();
        let up_entity = entity.clone();

        cell.child(text)
            .on_mouse_down(MouseButton::Left, move |event, _window, cx| {
                let shift = event.modifiers.shift;
                entity.update(cx, |table, cx| {
                    table.delegate_mut().range.press(row_ix, col_ix, shift);
                    cx.notify();
                });
            })
            .on_mouse_move(move |_event, _window, cx| {
                drag_entity.update(cx, |table, cx| {
                    if table.delegate().range.dragging {
                        table.delegate_mut().range.drag_to(row_ix, col_ix);
                        cx.notify();
                    }
                });
            })
            .on_mouse_up(MouseButton::Left, move |_event, _window, cx| {
                up_entity.update(cx, |table, cx| {
                    table.delegate_mut().range.release();
                    cx.notify();
                });
            })
    }
}

/// The canary window: a label above a table.
pub struct GridApp {
    table: Entity<TableState<GridDelegate>>,
    focus_handle: FocusHandle,
    editor: Entity<InputState>,
}

impl GridApp {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        Self::with_size(GridSize::from_env(), window, cx)
    }

    pub fn with_size(size: GridSize, window: &mut Window, cx: &mut Context<Self>) -> Self {
        // One editor entity for the whole grid; it is mounted only in the
        // editing cell, so its text never belongs to a stored cell.
        let editor = cx.new(|cx| InputState::new(window, cx));
        let table = cx.new(|cx| {
            TableState::new(
                GridDelegate::new(size).with_editor(editor.clone()),
                window,
                cx,
            )
            .cell_selectable(true)
            .row_header(true)
        });

        // Plain arrow keys stay with the table; sync the range from its
        // cell selection so a click or arrow key starts a one-cell range.
        cx.subscribe(&table, |this, _table, event: &TableEvent, cx| {
            if let TableEvent::SelectCell(row, col) = event {
                let row = *row;
                let col = *col;
                this.table.update(cx, |table, cx| {
                    let range = &mut table.delegate_mut().range;
                    if range.suppress_next_select {
                        range.suppress_next_select = false;
                    } else {
                        range.anchor = Some((row, col));
                        range.focus = Some((row, col));
                        range.dragging = false;
                    }
                    cx.notify();
                });
                cx.notify();
            }
        });

        let focus_handle = cx.focus_handle();
        window.focus(&focus_handle, cx);

        Self {
            table,
            focus_handle,
            editor,
        }
    }

    pub fn table(&self) -> &Entity<TableState<GridDelegate>> {
        &self.table
    }

    pub fn editor(&self) -> &Entity<InputState> {
        &self.editor
    }

    /// Mounts the editor in the focused cell, seeded with `initial` or with
    /// the cell's current text, and gives it focus.
    pub fn begin_edit(
        &mut self,
        initial: Option<&str>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some((row, col)) = self.table.read(cx).delegate().range.focus else {
            return;
        };
        let value = match initial {
            Some(text) => text.to_string(),
            None => self.table.read(cx).delegate().cell_text(row, col),
        };
        self.editor
            .update(cx, |state, cx| state.set_value(value, window, cx));
        self.table.update(cx, |table, cx| {
            table.delegate_mut().editing = Some((row, col));
            cx.notify();
        });
        let handle = self.editor.read(cx).focus_handle(cx);
        window.focus(&handle, cx);
        cx.notify();
    }

    /// Writes the editor's value into the editing cell, clears the editor and
    /// moves the selection one cell from there.
    pub fn commit_and_move(
        &mut self,
        d_row: i64,
        d_col: i64,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.table.read(cx).delegate().editing.is_none() {
            return;
        }
        let value = self.editor.read(cx).value().to_string();
        self.table.update(cx, |table, cx| {
            let size = table.delegate().size();
            let Some((row, col)) = table.delegate_mut().editing.take() else {
                return;
            };
            table.delegate_mut().edits.insert((row, col), value);
            let row = (row as i64 + d_row).clamp(0, size.rows as i64 - 1) as usize;
            let col = (col as i64 + d_col).clamp(0, size.cols as i64 - 1) as usize;
            let delegate = table.delegate_mut();
            delegate.range.anchor = Some((row, col));
            delegate.range.focus = Some((row, col));
            delegate.range.dragging = false;
            table.scroll_to_row(row, cx);
            table.scroll_to_col(col, cx);
            cx.notify();
        });
        let handle = self.focus_handle.clone();
        window.focus(&handle, cx);
        cx.notify();
    }

    /// Leaves the editing cell unchanged and returns focus to the grid.
    pub fn cancel_edit(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.table.update(cx, |table, cx| {
            table.delegate_mut().editing = None;
            cx.notify();
        });
        let handle = self.focus_handle.clone();
        window.focus(&handle, cx);
        cx.notify();
    }

    /// Whether the focused input has marked (composing) text. Enter, Tab and
    /// Escape belong to the composition until the mark clears.
    ///
    /// The state entity routes the IME calls through the same public handler
    /// the element installs; the bounds it takes are only used for point
    /// queries, and the editor is mounted whenever this path runs.
    fn editor_is_composing(&mut self, window: &mut Window, cx: &mut Context<Self>) -> bool {
        let bounds = self.editor.read(cx).input_bounds();
        let mut handler = ElementInputHandler::new(bounds, self.editor.clone());
        handler.marked_text_range(window, cx).is_some()
    }

    /// Writes the selected range as TSV. Rows end with `\n`, cells with `\t`.
    fn copy_range(&mut self, cx: &mut Context<Self>) {
        let Some(((r1, c1), (r2, c2))) = self.table.read(cx).delegate().range.normalized() else {
            return;
        };
        let mut lines = Vec::with_capacity(r2 - r1 + 1);
        for row in r1..=r2 {
            let mut cells = Vec::with_capacity(c2 - c1 + 1);
            for col in c1..=c2 {
                cells.push(self.table.read(cx).delegate().cell_text(row, col));
            }
            lines.push(cells.join("\t"));
        }
        cx.write_to_clipboard(ClipboardItem::new_string(lines.join("\n")));
    }

    /// Pastes TSV from the clipboard at the top-left of the selection, clipping
    /// at the grid's edges, then selects what was pasted.
    fn paste(&mut self, cx: &mut Context<Self>) {
        let Some(text) = cx.read_from_clipboard().and_then(|item| item.text()) else {
            return;
        };
        let text = text.replace('\r', "");
        let start = {
            let delegate = self.table.read(cx).delegate();
            delegate
                .range
                .normalized()
                .map(|(start, _)| start)
                .or(delegate.range.focus)
        };
        let Some(start) = start else {
            return;
        };
        let parsed: Vec<Vec<String>> = text
            .split('\n')
            .map(|line| line.split('\t').map(str::to_string).collect())
            .collect();
        let width = parsed.iter().map(Vec::len).max().unwrap_or(0);
        self.table.update(cx, |table, cx| {
            let size = table.delegate().size();
            let delegate = table.delegate_mut();
            for (d_row, line) in parsed.iter().enumerate() {
                let row = start.0 + d_row;
                if row >= size.rows {
                    break;
                }
                for (d_col, value) in line.iter().enumerate() {
                    let col = start.1 + d_col;
                    if col >= size.cols {
                        break;
                    }
                    delegate.edits.insert((row, col), value.clone());
                }
            }
            let last_row = (start.0 + parsed.len().saturating_sub(1)).min(size.rows - 1);
            let last_col = (start.1 + width.saturating_sub(1)).min(size.cols - 1);
            delegate.range.anchor = Some(start);
            delegate.range.focus = Some((last_row, last_col));
            delegate.range.dragging = false;
            table.scroll_to_row(last_row, cx);
            table.scroll_to_col(last_col, cx);
            cx.notify();
        });
    }

    /// Shift plus an arrow extends the focus one cell and scrolls to it.
    fn extend_focus(&mut self, d_row: i64, d_col: i64, cx: &mut Context<Self>) {
        self.table.update(cx, |table, cx| {
            let Some((_, (row, col))) = table.delegate().range.normalized() else {
                return;
            };
            let size = table.delegate().size();
            let row = (row as i64 + d_row).clamp(0, size.rows as i64 - 1) as usize;
            let col = (col as i64 + d_col).clamp(0, size.cols as i64 - 1) as usize;
            table.delegate_mut().range.focus = Some((row, col));
            table.scroll_to_row(row, cx);
            table.scroll_to_col(col, cx);
            cx.notify();
        });
        cx.notify();
    }

    /// Capture-phase `Cancel` (Escape). The table binds Escape, so the root
    /// has to see the action before the table does.
    fn on_action_cancel(&mut self, _: &Cancel, window: &mut Window, cx: &mut Context<Self>) {
        if self.table.read(cx).delegate().editing().is_none() {
            cx.propagate();
            return;
        }
        if !self.editor_is_composing(window, cx) {
            self.cancel_edit(window, cx);
        }
        cx.stop_propagation();
    }

    /// Capture-phase `SelectNextColumn` (Tab). Same reason: the table and the
    /// root both bind Tab below this node.
    fn on_action_select_next_column(
        &mut self,
        _: &SelectNextColumn,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.table.read(cx).delegate().editing().is_none() {
            cx.propagate();
            return;
        }
        if !self.editor_is_composing(window, cx) {
            self.commit_and_move(0, 1, window, cx);
        }
        cx.stop_propagation();
    }

    fn on_key_down(&mut self, event: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        let keystroke = &event.keystroke;
        let editing = self.table.read(cx).delegate().editing().is_some();

        if editing {
            if self.editor_is_composing(window, cx) {
                return;
            }
            match keystroke.key.as_str() {
                "enter" => {
                    self.commit_and_move(1, 0, window, cx);
                    cx.stop_propagation();
                }
                _ => {}
            }
            return;
        }

        if keystroke.modifiers.secondary(cx) {
            match keystroke.key.as_str() {
                "c" => {
                    self.copy_range(cx);
                    cx.stop_propagation();
                }
                "v" => {
                    self.paste(cx);
                    cx.stop_propagation();
                }
                _ => {}
            }
            return;
        }

        if keystroke.modifiers.shift {
            let (d_row, d_col) = match keystroke.key.as_str() {
                "up" => (-1, 0),
                "down" => (1, 0),
                "left" => (0, -1),
                "right" => (0, 1),
                _ => return,
            };
            self.extend_focus(d_row, d_col, cx);
            cx.stop_propagation();
            return;
        }

        if let Some(text) = keystroke.key_char.as_deref() {
            if !text.is_empty() && !text.chars().any(char::is_control) {
                let initial = text.to_string();
                self.begin_edit(Some(&initial), window, cx);
                cx.stop_propagation();
            }
        }
    }
}

impl Render for GridApp {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let label = self
            .table
            .read(cx)
            .delegate()
            .range
            .label()
            .unwrap_or_default();

        div()
            .flex()
            .flex_col()
            .key_context("GpuiGrid")
            .track_focus(&self.focus_handle)
            .on_key_down(cx.listener(Self::on_key_down))
            .capture_action(cx.listener(Self::on_action_cancel))
            .capture_action(cx.listener(Self::on_action_select_next_column))
            .size_full()
            .p_1()
            .gap_1()
            .child(
                div()
                    .id("range-label")
                    .h(px(20.))
                    .child(SharedString::from(label)),
            )
            .child(
                div().flex_1().child(
                    DataTable::new(&self.table)
                        .with_size(ComponentSize::XSmall)
                        .stripe(true)
                        .bordered(true),
                ),
            )
    }
}
