use crate::{
    errors::{Error, Result},
    flashcards::{self, Rating},
    notes::{self, Document},
    organization::{self, Location},
    packages,
    vault::{self, Snapshot},
    watcher,
};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{Manager, State};
#[derive(Default)]
pub struct Inner {
    pub root: Option<PathBuf>,
    pub snapshot: Option<Snapshot>,
    pub signature: String,
    watcher: Option<watcher::Guard>,
    import_plan: Option<packages::Plan>,
}
#[derive(Default, Clone)]
pub struct Backend(pub Arc<Mutex<Inner>>, pub Arc<AtomicBool>);
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
        inner.import_plan = None;
        inner.signature = serde_json::to_string(&snapshot)?;
        inner.snapshot = Some(snapshot.clone());
        Ok(snapshot)
    })
    .await
}

#[derive(serde::Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum OrganizationAction {
    NewNeuron {
        name: String,
    },
    NewSubject {
        neuron_id: String,
        name: String,
        preset: crate::subjects::Subject,
        color: String,
    },
    Rename {
        id: String,
        name: String,
    },
    Assign {
        subject_id: String,
        neuron_id: String,
    },
    Select {
        location: Location,
    },
}
#[tauri::command]
pub async fn organize(
    state: State<'_, Backend>,
    vault_root: String,
    action: OrganizationAction,
) -> Result<Snapshot> {
    work(&state, move |i| {
        let root = root(i, &vault_root)?;
        let (mut org, rev) = organization::load(&root)?;
        match action {
            OrganizationAction::NewNeuron { name } => {
                let id = org.new_neuron(&root, &name)?;
                org.location = Location {
                    neuron_id: Some(id),
                    subject_id: None,
                };
            }
            OrganizationAction::NewSubject {
                neuron_id,
                name,
                preset,
                color,
            } => {
                let id = org.new_subject(&root, &neuron_id, &name, preset, &color)?;
                org.location = Location {
                    neuron_id: Some(neuron_id),
                    subject_id: Some(id),
                };
            }
            OrganizationAction::Rename { id, name } => org.rename(&id, &name)?,
            OrganizationAction::Assign {
                subject_id,
                neuron_id,
            } => org.assign(&subject_id, &neuron_id)?,
            OrganizationAction::Select { location } => {
                org.check_location(&location)?;
                org.location = location;
            }
        }
        organization::save(&root, &org, Some(&rev))?;
        refresh(i, &root)
    })
    .await
}
#[tauri::command]
pub async fn create_note(
    state: State<'_, Backend>,
    vault_root: String,
    subject_id: String,
    path: String,
    vault_relative: Option<bool>,
) -> Result<(Snapshot, Document)> {
    work(&state, move |i| {
        let root = root(i, &vault_root)?;
        vault::contained(&root, path.trim(), true)?;
        if vault_relative.unwrap_or(false) {
            let title = path
                .rsplit('/')
                .next()
                .unwrap_or(&path)
                .trim_end_matches(".md");
            vault::atomic_write(&root, path.trim(), &format!("# {title}\n\n"), None, true)?;
            let doc = vault::read(&root, path.trim())?;
            return Ok((refresh(i, &root)?, doc));
        }
        let (mut org, rev) = organization::load(&root)?;
        let subject = org.subject(&subject_id)?.clone();
        let folder = if let Some(folder) = subject.root {
            folder
        } else {
            let neuron = org
                .neurons
                .iter()
                .find(|n| n.id == subject.neuron_id)
                .unwrap();
            std::fs::create_dir_all(vault::contained(&root, &neuron.path, false)?)?;
            let folder = organization::directory(&root, &neuron.path, &subject.name)?;
            org.subjects
                .iter_mut()
                .find(|s| s.id == subject_id)
                .unwrap()
                .root = Some(folder.clone());
            organization::save(&root, &org, Some(&rev))?;
            folder
        };
        let id = format!("{folder}/{}", path.trim());
        let title = path
            .rsplit('/')
            .next()
            .unwrap_or(&path)
            .trim_end_matches(".md");
        vault::atomic_write(&root, &id, &format!("# {title}\n\n"), None, true)?;
        let doc = vault::read(&root, &id)?;
        Ok((refresh(i, &root)?, doc))
    })
    .await
}
#[tauri::command]
pub async fn inspect_subject(
    state: State<'_, Backend>,
    vault_root: String,
    path: String,
) -> Result<packages::Preview> {
    let cancel = state.1.clone();
    cancel.store(false, Ordering::Relaxed);
    work(&state, move |i| {
        let root = root(i, &vault_root)?;
        i.import_plan = None;
        let plan = packages::inspect(&root, std::path::Path::new(&path), &cancel)?;
        let preview = plan.preview();
        i.import_plan = Some(plan);
        Ok(preview)
    })
    .await
}
#[tauri::command]
pub fn cancel_subject_import(state: State<'_, Backend>) {
    state.1.store(true, Ordering::Relaxed);
}
#[tauri::command]
pub async fn discard_subject_import(state: State<'_, Backend>) -> Result<()> {
    work(&state, |i| {
        i.import_plan = None;
        Ok(())
    })
    .await
}
#[tauri::command]
pub async fn import_subject(
    state: State<'_, Backend>,
    vault_root: String,
    token: String,
    neuron_id: String,
    name: String,
    include_history: bool,
) -> Result<Snapshot> {
    let cancel = state.1.clone();
    cancel.store(false, Ordering::Relaxed);
    work(&state, move |i| {
        let root = root(i, &vault_root)?;
        let plan = i
            .import_plan
            .as_ref()
            .filter(|p| p.token == token)
            .ok_or_else(|| Error::new("import", "Choose the import source again"))?;
        packages::import(&root, plan, &neuron_id, &name, include_history, &cancel)?;
        i.import_plan = None;
        refresh(i, &root)
    })
    .await
}
#[tauri::command]
pub async fn export_subject(
    state: State<'_, Backend>,
    vault_root: String,
    subject_id: String,
    path: String,
    include_history: bool,
) -> Result<()> {
    work(&state, move |i| {
        let root = root(i, &vault_root)?;
        let snapshot = vault::scan(&root)?;
        let plan = packages::prepare_export(
            &root,
            &snapshot,
            &subject_id,
            include_history,
            &AtomicBool::new(false),
        )?;
        packages::write_export(&plan, std::path::Path::new(&path))
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
