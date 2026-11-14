mod commands;
mod errors;
mod flashcards;
mod links;
mod notes;
mod organization;
#[cfg(test)]
mod organization_tests;
mod packages;
mod subjects;
#[cfg(test)]
mod tests;
mod transactions;
mod vault;
mod watcher;
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(commands::Backend::default())
        .invoke_handler(tauri::generate_handler![
            commands::restore_vault,
            commands::open_vault,
            commands::read_note,
            commands::save_note,
            commands::refresh_vault,
            commands::rate_card,
            commands::organize,
            commands::create_note,
            commands::inspect_subject,
            commands::cancel_subject_import,
            commands::discard_subject_import,
            commands::import_subject,
            commands::export_subject
        ])
        .run(tauri::generate_context!())
        .expect("failed to start Synapse");
}
