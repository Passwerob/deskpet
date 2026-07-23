use chrono::{Datelike, DateTime, Local};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Alarm {
    pub id: String,
    pub title: String,
    pub enabled: bool,
    pub time: String,
    pub date: Option<String>,
    pub repeat_mode: String,
    #[serde(default)]
    pub days: Vec<u32>,
    #[serde(default = "default_snooze")]
    pub snooze_minutes: u32,
    #[serde(default)]
    pub last_triggered_key: Option<String>,
    #[serde(default)]
    pub snoozed_until: Option<String>,
}

fn default_snooze() -> u32 {
    5
}

#[derive(Clone)]
pub struct AlarmState {
    alarms: Arc<Mutex<Vec<Alarm>>>,
    path: PathBuf,
}

impl AlarmState {
    pub fn load(app: &AppHandle) -> Result<Self, String> {
        let data_dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
        fs::create_dir_all(&data_dir).map_err(|error| error.to_string())?;
        let path = data_dir.join("alarms.json");
        let alarms = if path.exists() {
            let raw = fs::read_to_string(&path).map_err(|error| error.to_string())?;
            serde_json::from_str(&raw).unwrap_or_default()
        } else {
            Vec::new()
        };
        Ok(Self {
            alarms: Arc::new(Mutex::new(alarms)),
            path,
        })
    }

    pub fn list(&self) -> Result<Vec<Alarm>, String> {
        self.alarms
            .lock()
            .map(|alarms| alarms.clone())
            .map_err(|_| "无法读取闹钟数据".to_string())
    }

    pub fn save_alarm(&self, alarm: Alarm) -> Result<Vec<Alarm>, String> {
        let mut alarms = self
            .alarms
            .lock()
            .map_err(|_| "无法写入闹钟数据".to_string())?;
        if let Some(existing) = alarms.iter_mut().find(|item| item.id == alarm.id) {
            *existing = alarm;
        } else {
            alarms.push(alarm);
        }
        self.persist(&alarms)?;
        Ok(alarms.clone())
    }

    pub fn delete_alarm(&self, id: &str) -> Result<Vec<Alarm>, String> {
        let mut alarms = self
            .alarms
            .lock()
            .map_err(|_| "无法写入闹钟数据".to_string())?;
        alarms.retain(|alarm| alarm.id != id);
        self.persist(&alarms)?;
        Ok(alarms.clone())
    }

    pub fn snooze(&self, id: &str, minutes: u32) -> Result<(), String> {
        let mut alarms = self
            .alarms
            .lock()
            .map_err(|_| "无法写入闹钟数据".to_string())?;
        let until = Local::now() + chrono::Duration::minutes(minutes as i64);
        if let Some(alarm) = alarms.iter_mut().find(|alarm| alarm.id == id) {
            alarm.snoozed_until = Some(until.to_rfc3339());
            alarm.last_triggered_key = None;
        }
        self.persist(&alarms)
    }

    fn persist(&self, alarms: &[Alarm]) -> Result<(), String> {
        let json = serde_json::to_string_pretty(alarms).map_err(|error| error.to_string())?;
        fs::write(&self.path, json).map_err(|error| error.to_string())
    }
}

#[derive(Clone, Serialize)]
pub struct TriggeredAlarm {
    pub id: String,
    pub title: String,
}

pub fn start(app: AppHandle, state: AlarmState) {
    thread::spawn(move || loop {
        let now = Local::now();
        let mut triggered = Vec::new();

        if let Ok(mut alarms) = state.alarms.lock() {
            let mut changed = false;
            for alarm in alarms.iter_mut().filter(|alarm| alarm.enabled) {
                if should_trigger(alarm, now) {
                    let trigger_key = trigger_key(alarm, now);
                    alarm.last_triggered_key = Some(trigger_key);
                    alarm.snoozed_until = None;
                    if alarm.repeat_mode == "once" {
                        alarm.enabled = false;
                    }
                    triggered.push(TriggeredAlarm {
                        id: alarm.id.clone(),
                        title: alarm.title.clone(),
                    });
                    changed = true;
                }
            }
            if changed {
                let _ = state.persist(&alarms);
            }
        }

        for alarm in triggered {
            let _ = app.emit("alarm-triggered", alarm.clone());
            let notification = app
                .notification()
                .builder()
                .title("桌宠提醒")
                .body(&alarm.title);
            #[cfg(target_os = "macos")]
            let notification = notification.sound("Ping");
            let _ = notification.show();
            if let Some(pet) = app.get_webview_window("pet") {
                let _ = pet.show();
            }
        }

        thread::sleep(Duration::from_millis(750));
    });
}

fn should_trigger(alarm: &Alarm, now: DateTime<Local>) -> bool {
    if let Some(snoozed_until) = &alarm.snoozed_until {
        if let Ok(until) = DateTime::parse_from_rfc3339(snoozed_until) {
            let key = format!("snooze:{snoozed_until}");
            return now >= until.with_timezone(&Local)
                && alarm.last_triggered_key.as_deref() != Some(key.as_str());
        }
    }

    if now.format("%H:%M").to_string() != alarm.time {
        return false;
    }

    let key = now.format("%Y-%m-%d %H:%M").to_string();
    if alarm.last_triggered_key.as_deref() == Some(key.as_str()) {
        return false;
    }

    match alarm.repeat_mode.as_str() {
        "daily" => true,
        "weekdays" => (1..=5).contains(&now.weekday().num_days_from_sunday()),
        "custom" => alarm.days.contains(&now.weekday().num_days_from_sunday()),
        _ => alarm.date.as_deref() == Some(now.format("%Y-%m-%d").to_string().as_str()),
    }
}

fn trigger_key(alarm: &Alarm, now: DateTime<Local>) -> String {
    if let Some(snoozed_until) = &alarm.snoozed_until {
        if let Ok(until) = DateTime::parse_from_rfc3339(snoozed_until) {
            if now >= until.with_timezone(&Local) {
                return format!("snooze:{snoozed_until}");
            }
        }
    }
    now.format("%Y-%m-%d %H:%M").to_string()
}
