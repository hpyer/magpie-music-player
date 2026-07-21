use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{
    Manager, Monitor, PhysicalPosition, PhysicalSize, Runtime, WebviewWindow, WindowEvent,
};

const WINDOW_STATE_FILE: &str = "window-state.json";

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowState {
    x: i32,
    y: i32,
}

pub fn setup_window_position_memory<R: Runtime>(app: &tauri::App<R>) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    let state_path = app
        .path()
        .app_data_dir()
        .map(|dir| dir.join(WINDOW_STATE_FILE));

    if let Ok(path) = &state_path {
        restore_window_position(&window, path);
    } else {
        let _ = window.center();
    }

    if let Ok(path) = state_path {
        remember_window_position(window, path);
    }
}

fn restore_window_position<R: Runtime>(window: &WebviewWindow<R>, state_path: &Path) {
    let Some(state) = read_window_state(state_path) else {
        center_window(window, state_path);
        return;
    };

    let Ok(window_size) = window.outer_size() else {
        center_window(window, state_path);
        return;
    };

    let position = PhysicalPosition::new(state.x, state.y);
    if is_window_position_visible(window, position, window_size) {
        let _ = window.set_position(position);
    } else {
        center_window(window, state_path);
    }
}

fn remember_window_position<R: Runtime>(window: WebviewWindow<R>, state_path: PathBuf) {
    window.on_window_event(move |event| {
        if let WindowEvent::Moved(position) = event {
            write_window_state(&state_path, *position);
        }
    });
}

fn read_window_state(state_path: &Path) -> Option<WindowState> {
    let bytes = fs::read(state_path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn write_window_state(state_path: &Path, position: PhysicalPosition<i32>) {
    if let Some(parent) = state_path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    let state = WindowState {
        x: position.x,
        y: position.y,
    };

    if let Ok(json) = serde_json::to_vec_pretty(&state) {
        let _ = fs::write(state_path, json);
    }
}

fn center_window<R: Runtime>(window: &WebviewWindow<R>, state_path: &Path) {
    if window.center().is_ok() {
        if let Ok(position) = window.outer_position() {
            write_window_state(state_path, position);
        }
    }
}

fn is_window_position_visible<R: Runtime>(
    window: &WebviewWindow<R>,
    position: PhysicalPosition<i32>,
    window_size: PhysicalSize<u32>,
) -> bool {
    window
        .available_monitors()
        .map(|monitors| {
            monitors
                .iter()
                .any(|monitor| monitor_contains_window(monitor, position, window_size))
        })
        .unwrap_or(false)
}

fn monitor_contains_window(
    monitor: &Monitor,
    position: PhysicalPosition<i32>,
    window_size: PhysicalSize<u32>,
) -> bool {
    let work_area = monitor.work_area();
    let left = work_area.position.x;
    let top = work_area.position.y;
    let right = left.saturating_add(work_area.size.width as i32);
    let bottom = top.saturating_add(work_area.size.height as i32);
    let window_right = position.x.saturating_add(window_size.width as i32);
    let window_bottom = position.y.saturating_add(window_size.height as i32);

    position.x >= left && position.y >= top && window_right <= right && window_bottom <= bottom
}
