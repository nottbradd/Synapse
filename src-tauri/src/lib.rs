mod commands;
mod errors;
mod flashcards;
mod links;
mod notes;
mod subjects;
#[cfg(test)]
mod tests;
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
            commands::rate_card
        ])
        .run(tauri::generate_context!())
        .expect("failed to start Synapse");
}
