mod alarm_scheduler;

use alarm_scheduler::{Alarm, AlarmState, TriggeredAlarm};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, PhysicalPosition, State, WebviewWindow,
};

const PET_WINDOWS: [(&str, &str); 3] = [
    ("dog", "pet-dog"),
    ("cream-dog", "pet-cream-dog"),
    ("corgi-tuantuan", "pet-corgi-tuantuan"),
];

fn position_pet(window: &WebviewWindow, index: usize) {
    let Ok(Some(monitor)) = window.primary_monitor() else {
        return;
    };
    let Ok(window_size) = window.outer_size() else {
        return;
    };
    let work_area = monitor.work_area();
    let right = work_area.position.x + work_area.size.width as i32;
    let spacing = window_size.width as i32 - 18;
    let desired_x = right - window_size.width as i32 - 20 - index as i32 * spacing;
    let x = desired_x.max(work_area.position.x);
    let y = work_area.position.y + work_area.size.height as i32 - window_size.height as i32 - 18;
    let _ = window.set_position(PhysicalPosition::new(x, y));
}

#[tauri::command]
fn set_pet_visible(skin: String, visible: bool, app: tauri::AppHandle) -> Result<(), String> {
    let Some((_, label)) = PET_WINDOWS.iter().find(|(id, _)| *id == skin) else {
        return Err("未知的桌宠形象".to_string());
    };
    let Some(window) = app.get_webview_window(label) else {
        return Err("桌宠窗口尚未就绪".to_string());
    };
    if visible {
        window.show().map_err(|error| error.to_string())?;
    } else {
        window.hide().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn list_alarms(state: State<'_, AlarmState>) -> Result<Vec<Alarm>, String> {
    state.list()
}

#[tauri::command]
fn save_alarm(alarm: Alarm, state: State<'_, AlarmState>) -> Result<Vec<Alarm>, String> {
    state.save_alarm(alarm)
}

#[tauri::command]
fn delete_alarm(id: String, state: State<'_, AlarmState>) -> Result<Vec<Alarm>, String> {
    state.delete_alarm(&id)
}

#[tauri::command]
fn snooze_alarm(id: String, minutes: u32, state: State<'_, AlarmState>) -> Result<(), String> {
    state.snooze(&id, minutes)
}

#[tauri::command]
fn stop_alarm(id: String, app: tauri::AppHandle) -> Result<(), String> {
    app.emit("alarm-stopped", serde_json::json!({ "id": id }))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn trigger_test_alarm(app: tauri::AppHandle) -> Result<(), String> {
    app.emit(
        "alarm-triggered",
        TriggeredAlarm::preview("preview", "测试提醒"),
    )
    .map_err(|error| error.to_string())
}

impl TriggeredAlarm {
    fn preview(id: &str, title: &str) -> Self {
        Self {
            id: id.to_string(),
            title: title.to_string(),
        }
    }
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let settings_item = MenuItem::with_id(app, "settings", "打开闹钟", true, None::<&str>)?;
    let pet_item = MenuItem::with_id(app, "pet", "显示全部桌宠", true, None::<&str>)?;
    let hide_item = MenuItem::with_id(app, "hide", "隐藏全部桌宠", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&settings_item, &pet_item, &hide_item, &quit_item])?;

    let mut builder = TrayIconBuilder::new().menu(&menu).show_menu_on_left_click(true);
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder
        .on_menu_event(|app, event| match event.id.as_ref() {
            "settings" => {
                if let Some(window) = app.get_webview_window("settings") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "pet" => {
                for (_, label) in PET_WINDOWS {
                    if let Some(window) = app.get_webview_window(label) {
                        let _ = window.show();
                    }
                }
                let skins: Vec<&str> = PET_WINDOWS.iter().map(|(skin, _)| *skin).collect();
                let _ = app.emit("pet-visibility-changed", serde_json::json!({ "skins": skins }));
            }
            "hide" => {
                for (_, label) in PET_WINDOWS {
                    if let Some(window) = app.get_webview_window(label) {
                        let _ = window.hide();
                    }
                }
                let _ = app.emit(
                    "pet-visibility-changed",
                    serde_json::json!({ "skins": Vec::<&str>::new() }),
                );
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("settings") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .invoke_handler(tauri::generate_handler![
            list_alarms,
            save_alarm,
            delete_alarm,
            snooze_alarm,
            stop_alarm,
            trigger_test_alarm,
            set_pet_visible,
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            let _ = app
                .handle()
                .set_activation_policy(tauri::ActivationPolicy::Accessory);

            let state = AlarmState::load(app.handle()).map_err(std::io::Error::other)?;
            alarm_scheduler::start(app.handle().clone(), state.clone());
            app.manage(state);
            build_tray(app)?;

            for (index, (_, label)) in PET_WINDOWS.iter().enumerate() {
                if let Some(pet) = app.get_webview_window(label) {
                    position_pet(&pet, index);
                }
            }

            if let Some(settings) = app.get_webview_window("settings") {
                let settings_for_close = settings.clone();
                settings.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = settings_for_close.hide();
                    }
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run Zhuochong");
}
