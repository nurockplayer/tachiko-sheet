//! G1/G2 canary cases. Every case runs a real headless window: pointer and
//! keyboard events go through GPUI's normal dispatch, not the handlers
//! directly.

use std::time::{Duration, Instant};

use gpui_grid::{GridApp, GridSize};
use gpui_kit::base::Root;
use gpui_kit::test::{TestEventExt as _, TestWindowExt as _};
use gpui_kit::{
    App, AppContext, Bounds, Entity, InputEvent as _, Modifiers, MouseButton, Point, Pixels, Render,
    ScrollDelta, ScrollEvent, Size, TestAppContext, Window, WindowBounds, WindowHandle,
    WindowOptions, point, px, size,
};

/// The production entry point with deterministic test bounds, as Kit's own
/// integration tests open a window.
fn open_window<V: Render>(
    cx: &mut TestAppContext,
    bounds: Size<Pixels>,
    build: impl FnOnce(&mut Window, &mut App) -> Entity<V>,
) -> (WindowHandle<Root>, Entity<V>) {
    cx.update(|cx| {
        let (window, content) = gpui_kit::open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(Bounds {
                    origin: Point::default(),
                    size: bounds,
                })),
                ..Default::default()
            },
            cx,
            build,
        )
        .expect("open test window");
        (window.downcast::<Root>().expect("Base Root"), content)
    })
}

fn open_grid(
    cx: &mut TestAppContext,
    dims: GridSize,
) -> (WindowHandle<Root>, Entity<GridApp>) {
    cx.update(gpui_kit::init);
    open_window(cx, size(px(1024.), px(700.)), |window, cx| {
        cx.new(|cx| GridApp::with_size(dims, window, cx))
    })
}

fn range_label(app: &Entity<GridApp>, cx: &App) -> Option<String> {
    app.read(cx).table().read(cx).delegate().range.label()
}

/// The center of the first visible element with this id. The table may
/// register a fixed copy and a scrolling copy of the same cell.
fn cell_center(window: &Window, id: &str) -> Point<Pixels> {
    window
        .find_all(id.to_string())
        .into_iter()
        .find(|element| element.visible())
        .unwrap_or_else(|| panic!("no visible table cell {id}"))
        .bounds()
        .center()
}

fn press_cell(window: &mut Window, cx: &mut App, id: &str, shift: bool, release: bool) {
    let position = cell_center(window, id);
    let modifiers = Modifiers {
        shift,
        ..Default::default()
    };
    window.change_modifiers(modifiers, cx);
    window.pointer_down(position, MouseButton::Left, cx);
    if release {
        window.pointer_up(position, MouseButton::Left, cx);
        window.change_modifiers(Modifiers::default(), cx);
    }
}

fn scroll_to_end(table: &Entity<gpui_kit::component::table::TableState<gpui_grid::GridDelegate>>, dims: GridSize, cx: &mut App) {
    table.update(cx, |table, cx| {
        table.scroll_to_row(dims.rows - 1, cx);
        table.scroll_to_col(dims.cols - 1, cx);
    });
}

fn assert_g1(cx: &mut TestAppContext, dims: GridSize) {
    let (handle, content) = open_grid(cx, dims);
    cx.update_window(handle.into(), |_, window, cx| {
        let table = content.read(cx).table().clone();
        scroll_to_end(&table, dims, cx);
        window.render_frame(cx);

        let (rows, cols) = {
            let visible = table.read(cx).visible_range();
            (visible.rows().clone(), visible.cols().clone())
        };
        assert!(
            rows.contains(&(dims.rows - 1)),
            "last row {} missing from visible rows {:?}",
            dims.rows - 1,
            rows
        );
        assert!(
            cols.contains(&(dims.cols - 1)),
            "last column {} missing from visible cols {:?}",
            dims.cols - 1,
            cols
        );

        let first_row = rows.start;
        assert!(
            !window
                .find_all(format!("table-cell:{first_row}:0"))
                .is_empty(),
            "fixed first column is not rendered at row {first_row}"
        );
    })
    .unwrap();
}

#[gpui_kit::test]
fn g1a_b_last_row_and_column_reachable_10k(cx: &mut TestAppContext) {
    assert_g1(
        cx,
        GridSize {
            rows: 10_000,
            cols: 30,
        },
    );
}

#[gpui_kit::test]
fn g1a_b_last_row_and_column_reachable_100k(cx: &mut TestAppContext) {
    assert_g1(
        cx,
        GridSize {
            rows: 100_000,
            cols: 50,
        },
    );
}

fn drag_2_1_to_5_3(cx: &mut TestAppContext, dims: GridSize) -> Option<String> {
    let (handle, content) = open_grid(cx, dims);
    cx.update_window(handle.into(), |_, window, cx| {
        let from = cell_center(window, "table-cell:2:1");
        let to = cell_center(window, "table-cell:5:3");
        window.drag(from, to, cx);
        range_label(&content, cx)
    })
    .unwrap()
}

#[gpui_kit::test]
fn g2a_drag_selects_range_10k(cx: &mut TestAppContext) {
    let label = drag_2_1_to_5_3(
        cx,
        GridSize {
            rows: 10_000,
            cols: 30,
        },
    );
    assert_eq!(label.as_deref(), Some("R2C1:R5C3"));
}

#[gpui_kit::test]
fn g2a_drag_selects_range_100k(cx: &mut TestAppContext) {
    let label = drag_2_1_to_5_3(
        cx,
        GridSize {
            rows: 100_000,
            cols: 50,
        },
    );
    assert_eq!(label.as_deref(), Some("R2C1:R5C3"));
}

fn shift_press_selects_range(cx: &mut TestAppContext, dims: GridSize) -> Option<String> {
    let (handle, content) = open_grid(cx, dims);
    cx.update_window(handle.into(), |_, window, cx| {
        press_cell(window, cx, "table-cell:2:1", false, false);
        press_cell(window, cx, "table-cell:5:3", true, false);
        let label = range_label(&content, cx);
        press_cell(window, cx, "table-cell:5:3", true, true);
        label
    })
    .unwrap()
}

#[gpui_kit::test]
fn g2b_shift_press_extends_range_10k(cx: &mut TestAppContext) {
    let label = shift_press_selects_range(
        cx,
        GridSize {
            rows: 10_000,
            cols: 30,
        },
    );
    assert_eq!(label.as_deref(), Some("R2C1:R5C3"));
}

#[gpui_kit::test]
fn g2b_shift_press_extends_range_100k(cx: &mut TestAppContext) {
    let label = shift_press_selects_range(
        cx,
        GridSize {
            rows: 100_000,
            cols: 50,
        },
    );
    assert_eq!(label.as_deref(), Some("R2C1:R5C3"));
}

fn shift_arrows_select_range(cx: &mut TestAppContext, dims: GridSize) -> Option<String> {
    let (handle, content) = open_grid(cx, dims);
    cx.update_window(handle.into(), |_, window, cx| {
        window.click("table-cell:2:1", cx);
        window.press("shift-down", cx);
        window.press("shift-down", cx);
        window.press("shift-right", cx);
        range_label(&content, cx)
    })
    .unwrap()
}

#[gpui_kit::test]
fn g2c_shift_arrows_extend_range_10k(cx: &mut TestAppContext) {
    let label = shift_arrows_select_range(
        cx,
        GridSize {
            rows: 10_000,
            cols: 30,
        },
    );
    assert_eq!(label.as_deref(), Some("R2C1:R4C2"));
}

#[gpui_kit::test]
fn g2c_shift_arrows_extend_range_100k(cx: &mut TestAppContext) {
    let label = shift_arrows_select_range(
        cx,
        GridSize {
            rows: 100_000,
            cols: 50,
        },
    );
    assert_eq!(label.as_deref(), Some("R2C1:R4C2"));
}

#[gpui_kit::test]
fn g2d_drag_after_scrolling_has_no_offset_error(cx: &mut TestAppContext) {
    let dims = GridSize {
        rows: 10_000,
        cols: 30,
    };
    let (handle, content) = open_grid(cx, dims);
    cx.update_window(handle.into(), |_, window, cx| {
        let table = content.read(cx).table().clone();
        table.update(cx, |table, cx| table.scroll_to_row(5_000, cx));
        window.render_frame(cx);

        let from = cell_center(window, "table-cell:5002:1");
        let to = cell_center(window, "table-cell:5005:3");
        window.drag(from, to, cx);

        assert_eq!(range_label(&content, cx).as_deref(), Some("R5002C1:R5005C3"));
    })
    .unwrap();
}

/// A logged reading only: no threshold. The harness renders single frames and
/// has no GPU, so the numbers compare GPUI's layout cost, not real frame rate.
#[gpui_kit::test]
fn g1c_scroll_timing_10k(cx: &mut TestAppContext) {
    let dims = GridSize {
        rows: 10_000,
        cols: 30,
    };
    let (handle, _content) = open_grid(cx, dims);
    cx.update_window(handle.into(), |_, window, cx| {
        let position = cell_center(window, "table-cell:0:0");
        let mut samples = Vec::with_capacity(200);
        for _ in 0..200 {
            let start = Instant::now();
            window.dispatch_event(
                ScrollEvent {
                    position,
                    delta: ScrollDelta::Pixels(point(px(0.), px(480.))),
                    modifiers: Modifiers::default(),
                    ..Default::default()
                }
                .to_platform_input(),
                cx,
            );
            window.render_frame(cx);
            samples.push(start.elapsed());
        }
        let mean = samples.iter().sum::<Duration>() / samples.len() as u32;
        let max = samples.iter().max().copied().unwrap_or_default();
        println!(
            "G1c: 200 scroll steps of 480 px, mean {mean:?}, max {max:?} (headless harness, no GPU)"
        );
    })
    .unwrap();
}
