mod ai;
mod commands;
mod device;
mod errors;
mod flashcards;
mod hosted;
mod links;
mod notes;
mod organization;
#[cfg(test)]
mod organization_tests;
mod packages;
mod reminders;
mod study;
mod study_commands;
#[cfg(test)]
mod study_tests;
mod study_transfer;
mod subjects;
#[cfg(test)]
mod tests;
mod transactions;
mod vault;
mod watcher;
pub fn run() {
    use tauri::{Emitter, Manager};
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _| {
            if args.iter().any(|a| a == "--background") {
                return;
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .args(["--background"])
                .build(),
        )
        .manage(commands::Backend::default())
        .manage(ai::AiState::default())
        .setup(|app| {
            let directory = app.path().app_config_dir()?;
            #[cfg(all(debug_assertions, feature = "test-api"))]
            let directory = std::env::var_os("SYNAPSE_TEST_DEVICE_DIR")
                .map(std::path::PathBuf::from)
                .unwrap_or(directory);
            app.manage(
                device::Device::new(directory).map_err(|e| std::io::Error::other(e.message))?,
            );
            let open =
                tauri::menu::MenuItem::with_id(app, "open", "Open Synapse", true, None::<&str>)?;
            let quit =
                tauri::menu::MenuItem::with_id(app, "quit", "Quit Synapse", true, None::<&str>)?;
            let menu = tauri::menu::Menu::with_items(app, &[&open, &quit])?;
            tauri::tray::TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Synapse — study reminders")
                .menu(&menu)
                .on_menu_event(|app, event| {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.show();
                        let _ = w.unminimize();
                        let _ = w.set_focus();
                    }
                    if event.id.as_ref() == "quit" {
                        let _ = app.emit("synapse-quit-requested", ());
                    }
                })
                .build(app)?;
            reminders::start(app.handle().clone());
            let background_start = std::env::args().any(|a| a == "--background")
                && app
                    .state::<device::Device>()
                    .get()
                    .is_ok_and(|c| c.background);
            if !background_start {
                if let Some(window) = app.get_webview_window("main") {
                    window.show()?;
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::restore_vault,
            commands::open_vault,
            commands::read_note,
            commands::save_note,
            commands::refresh_vault,
            commands::rate_card,
            commands::preview_ratings,
            commands::present_note,
            commands::organize,
            commands::create_note,
            commands::inspect_subject,
            commands::cancel_subject_import,
            commands::discard_subject_import,
            commands::import_subject,
            commands::export_subject,
            study_commands::device_settings,
            study_commands::select_ai_provider,
            study_commands::enroll_synapse_ai,
            study_commands::synapse_ai_status,
            study_commands::forget_synapse_ai,
            study_commands::save_device_settings,
            study_commands::set_api_key,
            study_commands::remove_api_key,
            study_commands::test_api_connection,
            study_commands::study_context,
            study_commands::start_study_draft,
            study_commands::generate_study,
            study_commands::cancel_study,
            study_commands::study_list,
            study_commands::save_study_quiz,
            study_commands::save_study_flashcards,
            study_commands::preview_reminder,
            study_commands::save_study_reminder,
            study_commands::edit_study_reminder,
            study_commands::act_on_reminder,
            study_commands::save_quiz_attempt,
            study_commands::test_reminder_notification,
            study_commands::close_synapse_window,
            study_commands::startup_state,
            study_commands::set_startup
        ])
        .run(tauri::generate_context!())
        .expect("failed to start Synapse");
}
