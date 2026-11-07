use gpui_grid::GridApp;
use gpui_kit::*;

fn main() {
    gpui_kit::application().run(move |cx| {
        gpui_kit::init(cx);

        let window_options = WindowOptions {
            window_bounds: Some(WindowBounds::centered(size(px(1440.), px(900.)), cx)),
            ..Default::default()
        };

        gpui_kit::open_window(window_options, cx, |window, cx| {
            window.set_window_title("GPUI Grid Canary");
            cx.new(|cx| GridApp::new(window, cx))
        })
        .expect("Failed to open window");
    });
}
