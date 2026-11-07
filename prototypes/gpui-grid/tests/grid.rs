//! G1/G2 canary cases. Every case runs a real headless window: pointer and
//! keyboard events go through GPUI's normal dispatch, not the handlers
//! directly.

use std::time::{Duration, Instant};

use gpui_grid::{GridApp, GridSize};
use gpui_kit::base::Root;
use gpui_kit::test::{TestEventExt as _, TestWindowExt as _};
use gpui_kit::{
    App, AppContext, Bounds, ClipboardItem, ElementInputHandler, Entity, InputEvent as _,
    InputHandler as _, Modifiers, MouseButton, Point, Pixels, Render, ScrollDelta, ScrollEvent,
    Size, TestAppContext, Window, WindowBounds, WindowHandle, WindowOptions, point, px, size,
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

/// Two frames: the first applies deferred scrolls, the second registers the
/// elements they brought into view. Only rendered frames register elements.
fn settle(window: &mut Window, cx: &mut App) {
    window.render_frame(cx);
    window.render_frame(cx);
}

/// Kit's cell ids differ by kind: fixed columns use `table-cell:{row}:{col}`,
/// scrollable columns `table-cell-{row}:{col}`.
fn cell_id(row: usize, col: usize) -> String {
    if col == 0 {
        format!("table-cell:{row}:{col}")
    } else {
        format!("table-cell-{row}:{col}")
    }
}

/// How many registered elements carry this id, and how many of them are
/// visible. Used only in the failure message below.
fn probe(window: &Window, id: &str) -> (usize, usize) {
    let elements = window.find_all(id.to_string());
    let visible = elements.iter().filter(|element| element.visible()).count();
    (elements.len(), visible)
}

fn describe_probe(window: &Window, id: &str, registered: usize, visible: usize) -> String {
    let table = window
        .try_find("table")
        .map(|element| format!("{:?}", element.bounds()))
        .unwrap_or_else(|| "table id not registered".to_string());
    let corner = probe(window, &cell_id(0, 0));
    let first_col = probe(window, &cell_id(1, 0));
    let first_row = probe(window, &cell_id(0, 1));
    format!(
        "no visible table cell {id}: find_all returned {registered} element(s), {visible} visible; \
         probe 0:0 -> {} registered/{} visible, 1:0 -> {}/{}, 0:1 -> {}/{}; table bounds {table}",
        corner.0, corner.1, first_col.0, first_col.1, first_row.0, first_row.1
    )
}

/// The center of the first visible element with this id. The table may
/// register a fixed copy and a scrolling copy of the same cell.
fn cell_center(window: &Window, id: &str) -> Point<Pixels> {
    let elements = window.find_all(id.to_string());
    let visible = elements.iter().filter(|element| element.visible()).count();
    assert!(
        visible > 0,
        "{}",
        describe_probe(window, id, elements.len(), visible)
    );
    elements
        .into_iter()
        .find(|element| element.visible())
        .expect("checked visible above")
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
        settle(window, cx);

        let rows = {
            let visible = table.read(cx).visible_range();
            visible.rows().clone()
        };
        assert!(
            rows.contains(&(dims.rows - 1)),
            "last row {} missing from visible rows {:?}",
            dims.rows - 1,
            rows
        );

        // The column range is relative to the scrollable columns, so assert
        // the last cell's element instead.
        cell_center(window, &cell_id(dims.rows - 1, dims.cols - 1));

        let first_row = rows.start;
        assert!(
            !window.find_all(cell_id(first_row, 0)).is_empty(),
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
        settle(window, cx);
        let from = cell_center(window, &cell_id(2, 1));
        let to = cell_center(window, &cell_id(5, 3));
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
        settle(window, cx);
        press_cell(window, cx, &cell_id(2, 1), false, false);
        settle(window, cx);
        press_cell(window, cx, &cell_id(5, 3), true, false);
        settle(window, cx);
        let label = range_label(&content, cx);
        press_cell(window, cx, &cell_id(5, 3), true, true);
        settle(window, cx);
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
        settle(window, cx);
        window.click(cell_id(2, 1), cx);
        settle(window, cx);
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
        settle(window, cx);

        let from = cell_center(window, &cell_id(5002, 1));
        let to = cell_center(window, &cell_id(5005, 3));
        window.drag(from, to, cx);
        settle(window, cx);

        assert_eq!(range_label(&content, cx).as_deref(), Some("R5002C1:R5005C3"));
    })
    .unwrap();
}

/// The secondary-key chord for copy and paste on the host OS.
fn chord(key: &str) -> String {
    if cfg!(target_os = "macos") {
        format!("cmd-{key}")
    } else {
        format!("ctrl-{key}")
    }
}

fn delegate_cell_text(content: &Entity<GridApp>, cx: &App, row: usize, col: usize) -> String {
    content.read(cx).table().read(cx).delegate().cell_text(row, col)
}

fn editing_cell(content: &Entity<GridApp>, cx: &App) -> Option<(usize, usize)> {
    content.read(cx).table().read(cx).delegate().editing()
}

/// Click R2C1, type `x` plus `typed`, then commit with `final_key`. Returns
/// the cell text, the range label and whether an editor is still mounted.
fn edit_and_commit(
    cx: &mut TestAppContext,
    dims: GridSize,
    typed: &str,
    final_key: &str,
) -> (String, Option<String>, bool) {
    let (handle, content) = open_grid(cx, dims);
    cx.update_window(handle.into(), |_, window, cx| {
        settle(window, cx);
        window.click(cell_id(2, 1), cx);
        settle(window, cx);
        window.press("x", cx);
        settle(window, cx);
        window.input(typed, cx);
        settle(window, cx);
        window.press(final_key, cx);
        settle(window, cx);
        (
            delegate_cell_text(&content, cx, 2, 1),
            range_label(&content, cx),
            editing_cell(&content, cx).is_some(),
        )
    })
    .unwrap()
}

#[gpui_kit::test]
fn g3a_typing_and_enter_commit_10k(cx: &mut TestAppContext) {
    let (text, label, editing) = edit_and_commit(
        cx,
        GridSize {
            rows: 10_000,
            cols: 30,
        },
        "yz",
        "enter",
    );
    assert_eq!(text, "xyz");
    assert_eq!(label.as_deref(), Some("R3C1:R3C1"));
    assert!(!editing);
}

#[gpui_kit::test]
fn g3a_typing_and_enter_commit_100k(cx: &mut TestAppContext) {
    let (text, label, editing) = edit_and_commit(
        cx,
        GridSize {
            rows: 100_000,
            cols: 50,
        },
        "yz",
        "enter",
    );
    assert_eq!(text, "xyz");
    assert_eq!(label.as_deref(), Some("R3C1:R3C1"));
    assert!(!editing);
}

#[gpui_kit::test]
fn g3b_tab_commits_and_moves_right(cx: &mut TestAppContext) {
    let (text, label, editing) = edit_and_commit(
        cx,
        GridSize {
            rows: 10_000,
            cols: 30,
        },
        "yz",
        "tab",
    );
    assert_eq!(text, "xyz");
    assert_eq!(label.as_deref(), Some("R2C2:R2C2"));
    assert!(!editing);
}

#[gpui_kit::test]
fn g3c_escape_cancels_without_writing(cx: &mut TestAppContext) {
    let dims = GridSize {
        rows: 10_000,
        cols: 30,
    };
    let (handle, content) = open_grid(cx, dims);
    cx.update_window(handle.into(), |_, window, cx| {
        settle(window, cx);
        window.click(cell_id(2, 1), cx);
        settle(window, cx);
        window.press("x", cx);
        settle(window, cx);
        window.input("abc", cx);
        settle(window, cx);
        window.press("escape", cx);
        settle(window, cx);
        assert_eq!(delegate_cell_text(&content, cx, 2, 1), "R2C1");
        assert_eq!(editing_cell(&content, cx), None);
        assert_eq!(range_label(&content, cx).as_deref(), Some("R2C1:R2C1"));
    })
    .unwrap();
}

#[gpui_kit::test]
fn g3d_composing_text_blocks_enter_until_the_mark_clears(cx: &mut TestAppContext) {
    let dims = GridSize {
        rows: 10_000,
        cols: 30,
    };
    let (handle, content) = open_grid(cx, dims);
    cx.update_window(handle.into(), |_, window, cx| {
        settle(window, cx);
        window.click(cell_id(2, 1), cx);
        settle(window, cx);
        content.update(cx, |app, cx| app.begin_edit(Some(""), window, cx));
        settle(window, cx);

        let editor = content.read(cx).editor().clone();
        let bounds = window.find("cell-editor").bounds();
        let mut handler = ElementInputHandler::new(bounds, editor.clone());
        handler.replace_and_mark_text_in_range(None, "ni", Some(2..2), window, cx);
        window.press("enter", cx);
        settle(window, cx);
        assert_eq!(editing_cell(&content, cx), Some((2, 1)));
        assert_eq!(delegate_cell_text(&content, cx, 2, 1), "R2C1");

        let mut handler = ElementInputHandler::new(bounds, editor);
        handler.replace_text_in_range(None, "日本", window, cx);
        window.press("enter", cx);
        settle(window, cx);
        assert_eq!(delegate_cell_text(&content, cx, 2, 1), "日本");
    })
    .unwrap();
}

#[gpui_kit::test]
fn g3e_edit_after_scrolling_commits_and_moves(cx: &mut TestAppContext) {
    let dims = GridSize {
        rows: 10_000,
        cols: 30,
    };
    let (handle, content) = open_grid(cx, dims);
    cx.update_window(handle.into(), |_, window, cx| {
        let table = content.read(cx).table().clone();
        table.update(cx, |table, cx| table.scroll_to_row(5_000, cx));
        settle(window, cx);
        window.click(cell_id(5002, 1), cx);
        settle(window, cx);
        window.press("v", cx);
        settle(window, cx);
        window.input("alue", cx);
        settle(window, cx);
        window.press("enter", cx);
        settle(window, cx);
        assert_eq!(delegate_cell_text(&content, cx, 5002, 1), "value");
        assert_eq!(range_label(&content, cx).as_deref(), Some("R5003C1:R5003C1"));
        assert_eq!(editing_cell(&content, cx), None);
    })
    .unwrap();
}

#[gpui_kit::test]
fn g3f_composition_keeps_escape_from_cancelling(cx: &mut TestAppContext) {
    let dims = GridSize {
        rows: 10_000,
        cols: 30,
    };
    let (handle, content) = open_grid(cx, dims);
    cx.update_window(handle.into(), |_, window, cx| {
        settle(window, cx);
        window.click(cell_id(2, 1), cx);
        settle(window, cx);
        content.update(cx, |app, cx| app.begin_edit(Some(""), window, cx));
        settle(window, cx);

        let editor = content.read(cx).editor().clone();
        let bounds = window.find("cell-editor").bounds();
        let mut handler = ElementInputHandler::new(bounds, editor);
        handler.replace_and_mark_text_in_range(None, "ni", Some(2..2), window, cx);
        window.press("escape", cx);
        settle(window, cx);
        assert_eq!(editing_cell(&content, cx), Some((2, 1)));
        assert_eq!(delegate_cell_text(&content, cx, 2, 1), "R2C1");
    })
    .unwrap();
}

fn corner_bounds(window: &Window, id: &str) -> Bounds<Pixels> {
    window
        .find_all(id.to_string())
        .into_iter()
        .find(|element| element.visible())
        .expect("corner cell is registered and visible")
        .bounds()
}

/// The click must land on the cell before the paste can mean anything. On
/// failure this prints what the test saw, instead of a bare label mismatch.
fn assert_corner_selected(
    window: &Window,
    content: &Entity<GridApp>,
    cx: &App,
    id: &str,
    expected: &str,
) {
    let label = range_label(content, cx);
    let cell = window
        .find_all(id.to_string())
        .into_iter()
        .find(|element| element.visible())
        .map(|element| element.bounds());
    let table = window.try_find("table").map(|element| element.bounds());
    assert_eq!(
        label.as_deref(),
        Some(expected),
        "click at {id} did not select it: label {label:?}, cell bounds {cell:?}, table bounds {table:?}"
    );
}

#[gpui_kit::test]
fn g4a_copy_writes_the_range_as_tsv(cx: &mut TestAppContext) {
    let dims = GridSize {
        rows: 10_000,
        cols: 30,
    };
    let (handle, _content) = open_grid(cx, dims);
    cx.update_window(handle.into(), |_, window, cx| {
        settle(window, cx);
        let from = cell_center(window, &cell_id(2, 1));
        let to = cell_center(window, &cell_id(3, 2));
        window.drag(from, to, cx);
        settle(window, cx);
        let keystroke = chord("c");
        window.press(keystroke.as_str(), cx);
        settle(window, cx);
        let clipboard = cx
            .read_from_clipboard()
            .and_then(|item| item.text())
            .unwrap_or_default();
        assert_eq!(clipboard, "R2C1\tR2C2\nR3C1\tR3C2");
    })
    .unwrap();
}

#[gpui_kit::test]
fn g4b_paste_writes_cells_from_the_top_left(cx: &mut TestAppContext) {
    let dims = GridSize {
        rows: 10_000,
        cols: 30,
    };
    let (handle, content) = open_grid(cx, dims);
    cx.update_window(handle.into(), |_, window, cx| {
        settle(window, cx);
        cx.write_to_clipboard(ClipboardItem::new_string("a\tb\r\nc\td".to_string()));
        window.click(cell_id(7, 1), cx);
        settle(window, cx);
        let keystroke = chord("v");
        window.press(keystroke.as_str(), cx);
        settle(window, cx);
        assert_eq!(delegate_cell_text(&content, cx, 7, 1), "a");
        assert_eq!(delegate_cell_text(&content, cx, 7, 2), "b");
        assert_eq!(delegate_cell_text(&content, cx, 8, 1), "c");
        assert_eq!(delegate_cell_text(&content, cx, 8, 2), "d");
        assert_eq!(range_label(&content, cx).as_deref(), Some("R7C1:R8C2"));
    })
    .unwrap();
}

#[gpui_kit::test]
fn g4c_paste_at_the_corner_clips_without_panic(cx: &mut TestAppContext) {
    let dims = GridSize {
        rows: 10_000,
        cols: 30,
    };
    let (handle, content) = open_grid(cx, dims);
    cx.update_window(handle.into(), |_, window, cx| {
        let table = content.read(cx).table().clone();
        scroll_to_end(&table, dims, cx);
        settle(window, cx);
        let id = cell_id(dims.rows - 1, dims.cols - 1);
        cx.write_to_clipboard(ClipboardItem::new_string("1\t2\n3\t4".to_string()));
        window.click(id.clone(), cx);
        settle(window, cx);
        let expected = format!(
            "R{last}C{last_col}:R{last}C{last_col}",
            last = dims.rows - 1,
            last_col = dims.cols - 1
        );
        assert_corner_selected(window, &content, cx, &id, &expected);
        let keystroke = chord("v");
        window.press(keystroke.as_str(), cx);
        settle(window, cx);
        assert_eq!(
            delegate_cell_text(&content, cx, dims.rows - 1, dims.cols - 1),
            "1"
        );
        assert_eq!(
            delegate_cell_text(&content, cx, dims.rows - 1, dims.cols - 2),
            format!("R{}C{}", dims.rows - 1, dims.cols - 2)
        );
        assert_eq!(editing_cell(&content, cx), None);
    })
    .unwrap();
}

/// The same corner cell, clicked a quarter of its height from the top, in
/// case the centre of the last row sits under the horizontal scrollbar.
#[gpui_kit::test]
fn g4d_corner_cell_click_near_its_top(cx: &mut TestAppContext) {
    let dims = GridSize {
        rows: 10_000,
        cols: 30,
    };
    let (handle, content) = open_grid(cx, dims);
    cx.update_window(handle.into(), |_, window, cx| {
        let table = content.read(cx).table().clone();
        scroll_to_end(&table, dims, cx);
        settle(window, cx);
        let id = cell_id(dims.rows - 1, dims.cols - 1);
        cx.write_to_clipboard(ClipboardItem::new_string("1\t2\n3\t4".to_string()));
        let bounds = corner_bounds(window, &id);
        let position = point(
            bounds.origin.x + bounds.size.width / 2.0,
            bounds.origin.y + bounds.size.height * 0.25,
        );
        window.pointer_down(position, MouseButton::Left, cx);
        window.pointer_up(position, MouseButton::Left, cx);
        settle(window, cx);
        let expected = format!(
            "R{last}C{last_col}:R{last}C{last_col}",
            last = dims.rows - 1,
            last_col = dims.cols - 1
        );
        assert_corner_selected(window, &content, cx, &id, &expected);
        let keystroke = chord("v");
        window.press(keystroke.as_str(), cx);
        settle(window, cx);
        assert_eq!(
            delegate_cell_text(&content, cx, dims.rows - 1, dims.cols - 1),
            "1"
        );
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
        settle(window, cx);
        let position = cell_center(window, &cell_id(0, 0));
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
