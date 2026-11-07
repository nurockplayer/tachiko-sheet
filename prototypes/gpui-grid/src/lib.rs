//! Throwaway canary for Sheet #327: can GPUI Kit's `DataTable` host
//! spreadsheet range selection with less workaround than NSH's `DataTable`?
//!
//! The grid has no stored cells: text is derived from the row and column
//! index, and the only mutable state is [`RangeState`]. Selection is driven
//! by the table's own per-cell pointer events, so there is no pixel math.

use gpui_kit::component::{
    ActiveTheme as _, Sizable as _, Size as ComponentSize,
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
        }
    }

    pub fn size(&self) -> GridSize {
        self.size
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
        let entity = cx.entity();
        let drag_entity = entity.clone();
        let up_entity = entity.clone();

        let mut cell = div()
            .id(format!("grid-cell:{row_ix}:{col_ix}"))
            .size_full()
            .px_1();
        if inside {
            cell = cell.bg(tint);
        }
        cell.child(format!("R{row_ix}C{col_ix}"))
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
}

impl GridApp {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        Self::with_size(GridSize::from_env(), window, cx)
    }

    pub fn with_size(size: GridSize, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let table = cx.new(|cx| {
            TableState::new(GridDelegate::new(size), window, cx)
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
        }
    }

    pub fn table(&self) -> &Entity<TableState<GridDelegate>> {
        &self.table
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

    fn on_key_down(&mut self, event: &KeyDownEvent, _window: &mut Window, cx: &mut Context<Self>) {
        if !event.keystroke.modifiers.shift {
            return;
        }
        let (d_row, d_col) = match event.keystroke.key.as_str() {
            "up" => (-1, 0),
            "down" => (1, 0),
            "left" => (0, -1),
            "right" => (0, 1),
            _ => return,
        };
        self.extend_focus(d_row, d_col, cx);
        cx.stop_propagation();
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
