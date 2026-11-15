use crate::{commands::Backend, device::Device, study};
use std::{collections::BTreeSet, path::Path};
use tauri::{Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

pub fn start(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let mut reported = BTreeSet::new();
        loop {
            let device = app.state::<Device>();
            if let Ok(config) = device.get() {
                for root in config.reminder_vaults {
                    // Serialise with all writes in this process. Atomic revision checks
                    // also protect against another application editing study metadata.
                    let backend = app.state::<Backend>();
                    let result = (|| {
                        let _guard = backend
                            .0
                            .lock()
                            .map_err(|_| study::invalid("Reminder state is busy"))?;
                        let path = Path::new(&root);
                        if !path.is_dir() {
                            return Err(study::invalid(
                                "A reminder vault is unavailable. Reopen it to resume reminders.",
                            ));
                        }
                        let mut view = study::load(path)?;
                        let now = study::now();
                        let changed = view
                            .data
                            .reminders
                            .iter()
                            .any(|r| r.enabled && r.next_due.is_some_and(|due| due <= now));
                        let deliveries = study::advance(&mut view.data, now)?;
                        if changed {
                            // Durable claim precedes notification: a restart cannot
                            // deliver this occurrence twice. Pending items survive a
                            // crash or suppressed Windows notification in the catch-up view.
                            study::save(path, &view.data, view.revision.as_deref())?;
                            let _ = app.emit("study-changed", &root);
                        }
                        Ok(deliveries)
                    })();
                    match result {
                        Ok(deliveries) => {
                            reported.remove(&root);
                            if deliveries.is_empty() {
                                continue;
                            }
                            let fresh: Vec<_> = deliveries
                                .iter()
                                .filter(|d| {
                                    d.due >= device.started_at && study::now() - d.due <= 90
                                })
                                .collect();
                            let notification = if fresh.len() > 3 {
                                app.notification()
                                    .builder()
                                    .title("Study reminders")
                                    .body(format!("{} reminders are ready in Synapse", fresh.len()))
                                    .show()
                            } else {
                                let mut result = Ok(());
                                for d in fresh {
                                    if let Err(e) = app
                                        .notification()
                                        .builder()
                                        .id((uuid::Uuid::parse_str(&d.id).unwrap().as_u128()
                                            & 0x7fff_ffff)
                                            as i32)
                                        .title(&d.title)
                                        .body("Open Synapse to review, dismiss or snooze")
                                        .show()
                                    {
                                        result = Err(e);
                                    }
                                }
                                result
                            };
                            if notification.is_err() {
                                let _ = app.emit("study-error","Windows could not show a notification. Your reminders are available in the catch-up view.");
                            }
                        }
                        Err(error) => {
                            if reported.insert(root) {
                                let _ = app.emit("study-error", error.message);
                            }
                        }
                    }
                }
            }
            std::thread::sleep(std::time::Duration::from_secs(2));
        }
    });
}
