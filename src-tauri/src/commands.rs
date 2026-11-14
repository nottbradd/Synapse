use crate::{
    errors::{Error, Result},
    flashcards::{self, Rating},
    notes::{self, Document},
    vault::{self, Snapshot},
    watcher,
};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{Manager, State};
#[derive(Default)]
pub struct Inner {
    pub root: Option<PathBuf>,
    pub snapshot: Option<Snapshot>,
    pub signature: String,
    watcher: Option<watcher::Guard>,
}
#[derive(Default, Clone)]
pub struct Backend(pub Arc<Mutex<Inner>>);
fn root(inner: &Inner, expected: &str) -> Result<PathBuf> {
    let p = inner
        .root
        .clone()
        .ok_or_else(|| Error::new("vault", "Open a vault first"))?;
    if p.to_string_lossy() != expected {
        return Err(Error::new("vault", "The active vault changed; try again."));
    }
    Ok(p)
}
fn refresh(inner: &mut Inner, path: &std::path::Path) -> Result<Snapshot> {
    let s = vault::scan(path)?;
    inner.signature = serde_json::to_string(&s)?;
    inner.snapshot = Some(s.clone());
    Ok(s)
}
async fn work<T: Send + 'static>(
    state: &Backend,
    f: impl FnOnce(&mut Inner) -> Result<T> + Send + 'static,
) -> Result<T> {
    let state = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut s = state
            .lock()
            .map_err(|_| Error::new("state", "State lock unavailable"))?;
        f(&mut s)
    })
    .await
    .map_err(|e| Error::new("task", e))?
}
#[tauri::command]
pub async fn restore_vault(
    app: tauri::AppHandle,
    state: State<'_, Backend>,
) -> Result<Option<Snapshot>> {
    let path = app
        .path()
        .app_config_dir()
        .map_err(|e| Error::new("config", e))?
        .join("last-vault.json");
    if !path.exists() {
        return Ok(None);
    }
    let previous: String = serde_json::from_str(&std::fs::read_to_string(path)?)?;
    open_vault(app, state, previous).await.map(Some)
}
#[tauri::command]
pub async fn open_vault(
    app: tauri::AppHandle,
    state: State<'_, Backend>,
    path: String,
) -> Result<Snapshot> {
    let shared = Arc::downgrade(&state.0);
    work(&state, move |inner| {
        let path = PathBuf::from(path).canonicalize()?;
        if !path.is_dir() {
            return Err(Error::new("vault", "Choose a folder"));
        }
        let snapshot = vault::scan(&path)?;
        let watcher = watcher::start(&path, shared, app.clone())?;
        let config = app
            .path()
            .app_config_dir()
            .map_err(|e| Error::new("config", e))?;
        std::fs::create_dir_all(&config)?;
        let config = config.canonicalize()?;
        let old = std::fs::read_to_string(config.join("last-vault.json"))
            .ok()
            .map(|s| notes::hash(&s));
        vault::atomic_write(
            &config,
            "last-vault.json",
            &serde_json::to_string(&path.to_string_lossy())?,
            old.as_deref(),
            false,
        )?;
        inner.watcher = Some(watcher);
        inner.root = Some(path);
        inner.signature = serde_json::to_string(&snapshot)?;
        inner.snapshot = Some(snapshot.clone());
        Ok(snapshot)
    })
    .await
}
#[tauri::command]
pub async fn read_note(
    state: State<'_, Backend>,
    vault_root: String,
    id: String,
) -> Result<Document> {
    work(&state, move |i| vault::read(&root(i, &vault_root)?, &id)).await
}
#[tauri::command]
pub async fn save_note(
    state: State<'_, Backend>,
    vault_root: String,
    id: String,
    content: String,
    revision: Option<String>,
) -> Result<Snapshot> {
    work(&state, move |i| {
        let root = root(i, &vault_root)?;
        vault::atomic_write(&root, &id, &content, revision.as_deref(), true)?;
        refresh(i, &root)
    })
    .await
}
#[tauri::command]
pub async fn refresh_vault(state: State<'_, Backend>, vault_root: String) -> Result<Snapshot> {
    work(&state, move |i| {
        let root = root(i, &vault_root)?;
        refresh(i, &root)
    })
    .await
}
#[tauri::command]
pub async fn rate_card(
    state: State<'_, Backend>,
    vault_root: String,
    id: String,
    rating: Rating,
) -> Result<Snapshot> {
    work(&state, move |i| {
        let root = root(i, &vault_root)?;
        let snapshot = vault::scan(&root)?;
        if !snapshot.cards.iter().any(|c| c.id == id) {
            return Err(Error::new(
                "card",
                "This card changed or was removed. Refresh your session.",
            ));
        }
        let (mut history, revision) = flashcards::load(&root)?;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| Error::new("clock", e))?
            .as_secs() as i64;
        if history.cards.get(&id).is_some_and(|r| r.due > now) {
            return Err(Error::new("card", "This card is not due yet."));
        }
        history.cards.insert(
            id.clone(),
            flashcards::schedule(&id, history.cards.get(&id), rating, now),
        );
        vault::atomic_write(
            &root,
            "flashcards.json",
            &serde_json::to_string_pretty(&history)?,
            revision.as_deref(),
            false,
        )?;
        refresh(i, &root)
    })
    .await
}
