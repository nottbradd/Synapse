use crate::{
    ai::{self, AiState, DraftOrigin, Kind},
    commands::{self, Backend},
    device::{self, CredentialStore, Device, OsCredential},
    errors::{Error, Result},
    organization,
    study::{self, ReminderDraft},
    vault,
};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::{Emitter, Manager, State};
use zeroize::Zeroizing;

#[tauri::command]
pub fn select_ai_provider(
    device: State<'_, Device>,
    ai: State<'_, AiState>,
    provider: device::Provider,
    consent: bool,
) -> Result<device::SettingsView> {
    if provider == device::Provider::Synapse && !consent && !device.get()?.hosted_consent {
        return Err(Error::new(
            "hosted_consent",
            "Read and accept the Synapse AI data notice first.",
        ));
    }
    ai.cancel_running();
    device.update(|c| {
        c.provider = provider;
        if provider == device::Provider::Synapse {
            c.hosted_consent = true;
        }
        Ok(())
    })?;
    Ok(device::view(&device))
}
#[tauri::command]
pub async fn enroll_synapse_ai(
    device: State<'_, Device>,
    invitation: String,
    consent: bool,
) -> Result<device::SettingsView> {
    crate::hosted::enroll(&device, invitation, consent).await?;
    Ok(device::view(&device))
}
#[tauri::command]
pub async fn synapse_ai_status(device: State<'_, Device>) -> Result<serde_json::Value> {
    crate::hosted::status(&device).await
}
#[tauri::command]
pub async fn forget_synapse_ai(
    device: State<'_, Device>,
    ai: State<'_, AiState>,
    local_only: bool,
) -> Result<device::SettingsView> {
    ai.cancel_running();
    if local_only {
        crate::hosted::forget_local(&device)?;
    } else {
        crate::hosted::forget(&device).await?;
    }
    Ok(device::view(&device))
}

#[tauri::command]
pub fn device_settings(device: State<'_, Device>) -> device::SettingsView {
    device::view(&device)
}
#[tauri::command]
pub fn save_device_settings(
    device: State<'_, Device>,
    settings: device::SettingsInput,
) -> Result<device::SettingsView> {
    device.update(|c| {
        c.model = settings.model;
        c.max_output_tokens = settings.max_output_tokens;
        c.timezone = settings.timezone;
        c.background = settings.background;
        Ok(())
    })?;
    Ok(device::view(&device))
}
#[tauri::command]
pub async fn set_api_key(device: State<'_, Device>, key: String) -> Result<device::SettingsView> {
    let key = Zeroizing::new(key);
    tauri::async_runtime::spawn_blocking(move || OsCredential.write(&key))
        .await
        .map_err(|_| Error::new("credentials", "Credential storage task failed"))??;
    Ok(device::view(&device))
}
#[tauri::command]
pub fn remove_api_key(
    device: State<'_, Device>,
    ai: State<'_, AiState>,
) -> Result<device::SettingsView> {
    ai.cancel(None);
    OsCredential.remove()?;
    Ok(device::view(&device))
}
#[tauri::command]
pub async fn test_api_connection(device: State<'_, Device>) -> Result<device::SettingsView> {
    let key = OsCredential
        .read()?
        .ok_or_else(|| Error::new("api_key", "Add an API key first"))?;
    let config = device.get()?;
    let body = serde_json::json!({"model":config.model,"store":false,"reasoning":{"effort":"none"},"max_output_tokens":128,"input":"Return the JSON object with ok set to true.","text":{"format":{"type":"json_schema","name":"connection_test","strict":true,"schema":{"type":"object","properties":{"ok":{"type":"boolean"}},"required":["ok"],"additionalProperties":false}}}});
    let response = ai::post(
        &device.client,
        &key,
        body,
        &tokio_util::sync::CancellationToken::new(),
    )
    .await?;
    device.usage(
        response
            .pointer("/usage/input_tokens")
            .and_then(|v| v.as_u64())
            .unwrap_or(0),
        response
            .pointer("/usage/output_tokens")
            .and_then(|v| v.as_u64())
            .unwrap_or(0),
    )?;
    if response.get("status").and_then(|v| v.as_str()) != Some("completed") {
        return Err(Error::new(
            "api",
            "The connection succeeded, but OpenAI did not complete the small test response",
        ));
    }
    let valid = response
        .get("output")
        .and_then(|v| v.as_array())
        .into_iter()
        .flatten()
        .filter_map(|v| v.get("content").and_then(|v| v.as_array()))
        .flatten()
        .filter_map(|v| v.get("text").and_then(|v| v.as_str()))
        .any(|t| {
            serde_json::from_str::<serde_json::Value>(t)
                .ok()
                .is_some_and(|v| v == serde_json::json!({"ok":true}))
        });
    if !valid {
        return Err(Error::new(
            "api_schema",
            "The connection test returned unexpected output",
        ));
    }
    Ok(device::view(&device))
}
#[tauri::command]
pub async fn study_context(
    state: State<'_, Backend>,
    ai: State<'_, AiState>,
    vault_root: String,
    source_ids: Vec<String>,
    kind: Kind,
) -> Result<ai::Context> {
    let context = commands::work(&state, move |i| {
        commands::root(i, &vault_root)?;
        ai::prepare(
            i.snapshot.as_ref().ok_or_else(ai::stale)?,
            &source_ids,
            kind,
        )
    })
    .await?;
    ai.remember(context)
}
#[tauri::command]
pub fn start_study_draft(
    state: State<'_, Backend>,
    ai: State<'_, AiState>,
    context_token: String,
) -> Result<String> {
    let context = ai.context(&context_token)?;
    context.check(&state)?;
    if context.kind != Kind::Reminder && context.sources.is_empty() {
        return Err(study::invalid("Choose at least one source note"));
    }
    let id = study::id();
    let mut requests =
        ai.0.lock()
            .map_err(|_| study::invalid("Study requests are busy"))?;
    if requests.drafts.len() >= 20 {
        return Err(study::invalid(
            "Close an existing draft before creating another",
        ));
    }
    requests.drafts.insert(
        id.clone(),
        DraftOrigin {
            kind: context.kind.clone(),
            context,
        },
    );
    Ok(id)
}
#[tauri::command]
pub async fn generate_study(
    state: State<'_, Backend>,
    ai: State<'_, AiState>,
    device: State<'_, Device>,
    request: ai::Generate,
) -> Result<ai::Generated> {
    ai::generate(&ai, &state, &device, request).await
}
#[tauri::command]
pub fn cancel_study(ai: State<'_, AiState>, request_id: Option<String>) {
    ai.cancel(request_id.as_deref());
}
#[tauri::command]
pub async fn study_list(state: State<'_, Backend>, vault_root: String) -> Result<study::View> {
    commands::work(&state, move |i| {
        study::load(&commands::root(i, &vault_root)?)
    })
    .await
}
fn scope(
    i: &commands::Inner,
    root: &str,
    origin: &DraftOrigin,
    kind: Kind,
) -> Result<std::path::PathBuf> {
    let path = commands::root(i, root)?;
    if origin.kind != kind
        || origin.context.root != root
        || i.snapshot
            .as_ref()
            .is_none_or(|s| s.organization.location != origin.context.location)
    {
        return Err(ai::stale());
    }
    Ok(path)
}
fn changed(app: &tauri::AppHandle, root: &str) {
    let _ = app.emit("study-changed", root);
}
#[tauri::command]
pub async fn save_study_quiz(
    app: tauri::AppHandle,
    state: State<'_, Backend>,
    ai: State<'_, AiState>,
    vault_root: String,
    request_id: String,
    subject_id: String,
    draft: study::QuizDraft,
) -> Result<study::View> {
    let origin = ai.origin(&request_id)?;
    let result = commands::work(&state, move |i| {
        let root = scope(i, &vault_root, &origin, Kind::Quiz)?;
        let mut view = study::load(&root)?;
        if view.data.receipts.contains_key(&request_id) {
            return Ok(view);
        }
        organization::load(&root)?.0.subject(&subject_id)?;
        study::validate_quiz(&draft, &origin.context.ids())?;
        view.data.quizzes.push(study::Quiz {
            id: request_id.clone(),
            subject_id,
            created_at: study::now(),
            draft,
            sources: origin.context.refs(),
        });
        view.data.receipts.insert(
            request_id.clone(),
            study::Receipt {
                kind: "quiz".into(),
                target: request_id,
            },
        );
        study::save(&root, &view.data, view.revision.as_deref())?;
        changed(&app, &vault_root);
        study::load(&root)
    })
    .await?;
    Ok(result)
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FlashcardDestination {
    pub subject_id: String,
    pub note_id: Option<String>,
    pub new_path: String,
    pub revision: Option<String>,
}
#[derive(Serialize)]
pub struct FlashcardSaved {
    pub snapshot: vault::Snapshot,
    pub note_id: String,
    pub study: study::View,
}
fn subject_folder(root: &Path, subject_id: &str) -> Result<String> {
    let (mut org, revision) = organization::load(root)?;
    let subject = org.subject(subject_id)?.clone();
    if let Some(folder) = subject.root {
        return Ok(folder);
    }
    let neuron = org
        .neurons
        .iter()
        .find(|n| n.id == subject.neuron_id)
        .ok_or_else(|| study::invalid("Subject Neuron is missing"))?;
    std::fs::create_dir_all(vault::contained(root, &neuron.path, false)?)?;
    let folder = organization::directory(root, &neuron.path, &subject.name)?;
    org.subjects
        .iter_mut()
        .find(|s| s.id == subject_id)
        .unwrap()
        .root = Some(folder.clone());
    organization::save(root, &org, Some(&revision))?;
    Ok(folder)
}
#[tauri::command]
pub async fn save_study_flashcards(
    app: tauri::AppHandle,
    state: State<'_, Backend>,
    ai: State<'_, AiState>,
    vault_root: String,
    request_id: String,
    draft: study::FlashcardDraft,
    destination: FlashcardDestination,
) -> Result<FlashcardSaved> {
    let origin = ai.origin(&request_id)?;
    commands::work(&state, move |i| {
        let root = scope(i, &vault_root, &origin, Kind::Flashcards)?;
        let (note_id, view) = persist_flashcards(
            &root,
            request_id,
            draft,
            destination,
            &origin,
            i.snapshot.as_ref().unwrap(),
        )?;
        changed(&app, &vault_root);
        Ok(FlashcardSaved {
            snapshot: commands::refresh(i, &root)?,
            note_id,
            study: view,
        })
    })
    .await
}
pub(crate) fn persist_flashcards(
    root: &Path,
    request_id: String,
    draft: study::FlashcardDraft,
    destination: FlashcardDestination,
    origin: &DraftOrigin,
    snapshot: &vault::Snapshot,
) -> Result<(String, study::View)> {
    let mut view = study::load(root)?;
    if let Some(saved) = view.data.receipts.get(&request_id) {
        return Ok((saved.target.clone(), view));
    }
    study::validate_cards(&draft, &origin.context.ids())?;
    organization::load(root)?
        .0
        .subject(&destination.subject_id)?;
    let existing = destination.note_id.is_some();
    let note_id = if let Some(id) = destination.note_id {
        if origin.context.ids().contains(&id) {
            return Err(study::invalid(
                "Choose a destination other than the source notes",
            ));
        }
        if !snapshot
            .notes
            .iter()
            .any(|n| n.id == id && n.subject_id == destination.subject_id)
        {
            return Err(study::invalid(
                "The destination note is outside the chosen subject",
            ));
        }
        id
    } else {
        vault::contained(root, destination.new_path.trim(), true)?;
        format!(
            "{}/{}",
            subject_folder(root, &destination.subject_id)?,
            destination.new_path.trim()
        )
    };
    let prefix = format!("<!-- synapse-draft:{request_id}:");
    let marker = format!(
        "{prefix}{} -->",
        crate::notes::hash(&serde_json::to_string(&draft)?)
    );
    let current = if vault::contained(root, &note_id, true)?.exists() {
        Some(vault::read(root, &note_id)?)
    } else {
        None
    };
    view.data.flashcard_batches.push(study::FlashcardBatch {
        id: request_id.clone(),
        subject_id: destination.subject_id.clone(),
        note_id: note_id.clone(),
        created_at: study::now(),
        draft: draft.clone(),
        sources: origin.context.refs(),
    });
    view.data.receipts.insert(
        request_id.clone(),
        study::Receipt {
            kind: "flashcards".into(),
            target: note_id.clone(),
        },
    );
    study::validate(&view.data)?;
    if serde_json::to_vec(&view.data)?.len() > 8 * 1024 * 1024 {
        return Err(study::invalid("Study storage exceeds 8 MiB"));
    }
    if current
        .as_ref()
        .is_some_and(|d| d.content.contains(&prefix) && !d.content.contains(&marker))
    {
        return Err(Error::new("conflict", "A partial save already wrote an earlier version of this draft. Recover that version before editing it."));
    }
    if !current
        .as_ref()
        .is_some_and(|d| d.content.contains(&marker))
    {
        if existing
            && current
                .as_ref()
                .is_none_or(|d| Some(&d.revision) != destination.revision.as_ref())
        {
            return Err(Error::new(
                "conflict",
                "The destination note changed. Reload its revision before saving.",
            ));
        }
        if !existing && current.is_some() {
            return Err(Error::new("conflict","That note already exists. Choose a new name or select an existing destination explicitly."));
        }
        let mut content = current
            .as_ref()
            .map(|d| d.content.clone())
            .unwrap_or_else(|| format!("# {}\n", draft.title));
        content.push_str(&format!("\n\n{marker}\n\n"));
        for c in &draft.cards {
            content.push_str(&format!(
                "Q: {}\nA: {}\n\n",
                c.question.trim(),
                c.answer.trim()
            ));
            let links: Vec<_> = c
                .sources
                .iter()
                .filter(|id| !id.contains(['[', ']', '|', '\n', '\r']))
                .map(|id| format!("[[./{}]]", id.trim_end_matches(".md")))
                .collect();
            if !links.is_empty() {
                content.push_str(&format!("Source notes: {}\n\n", links.join(", ")));
            }
        }
        vault::atomic_write(
            root,
            &note_id,
            &content,
            current.as_ref().map(|d| d.revision.as_str()),
            true,
        )?;
    }
    study::save(root, &view.data, view.revision.as_deref())?;
    Ok((note_id, study::load(root)?))
}

fn reminder_target(root: &Path, draft: &ReminderDraft, snapshot: &vault::Snapshot) -> Result<()> {
    if let Some(subject) = &draft.subject_id {
        snapshot.organization.subject(subject)?;
    }
    if let Some(id) = &draft.source_id {
        vault::contained(root, id, true)?;
        let note = snapshot
            .notes
            .iter()
            .find(|n| &n.id == id)
            .ok_or_else(|| study::invalid("The reminder target note is missing"))?;
        if draft
            .subject_id
            .as_ref()
            .is_some_and(|s| s != &note.subject_id)
        {
            return Err(study::invalid(
                "The target note does not belong to the chosen subject",
            ));
        }
    }
    Ok(())
}
#[tauri::command]
pub fn preview_reminder(draft: ReminderDraft) -> Result<study::ResolvedReminder> {
    study::resolve_reminder(&draft, study::now(), true)
}
#[tauri::command]
pub async fn save_study_reminder(
    app: tauri::AppHandle,
    state: State<'_, Backend>,
    ai: State<'_, AiState>,
    device: State<'_, Device>,
    vault_root: String,
    request_id: String,
    draft: ReminderDraft,
) -> Result<study::View> {
    let origin = ai.origin(&request_id)?;
    origin.context.check(&state)?;
    if origin.context.root != vault_root {
        return Err(ai::stale());
    }
    device.register(Path::new(&vault_root))?;
    commands::work(&state, move |i| {
        let root = scope(i, &vault_root, &origin, Kind::Reminder)?;
        let mut view = study::load(&root)?;
        if view.data.receipts.contains_key(&request_id) {
            return Ok(view);
        }
        reminder_target(&root, &draft, i.snapshot.as_ref().unwrap())?;
        let due = study::resolve_reminder(&draft, study::now(), true)?.due;
        view.data.reminders.push(study::Reminder {
            id: request_id.clone(),
            draft,
            enabled: true,
            next_due: Some(due),
            pending_due: None,
            last_delivered: None,
            created_at: study::now(),
        });
        view.data.receipts.insert(
            request_id.clone(),
            study::Receipt {
                kind: "reminder".into(),
                target: request_id,
            },
        );
        study::save(&root, &view.data, view.revision.as_deref())?;
        changed(&app, &vault_root);
        study::load(&root)
    })
    .await
}
#[tauri::command]
pub async fn edit_study_reminder(
    app: tauri::AppHandle,
    state: State<'_, Backend>,
    device: State<'_, Device>,
    vault_root: String,
    id: String,
    draft: ReminderDraft,
    revision: String,
) -> Result<study::View> {
    {
        let i = state
            .0
            .lock()
            .map_err(|_| study::invalid("Workspace is busy"))?;
        commands::root(&i, &vault_root)?;
    }
    device.register(Path::new(&vault_root))?;
    commands::work(&state, move |i| {
        let root = commands::root(i, &vault_root)?;
        reminder_target(&root, &draft, i.snapshot.as_ref().unwrap())?;
        let due = study::resolve_reminder(&draft, study::now(), true)?.due;
        let mut view = study::load(&root)?;
        if view.revision.as_deref() != Some(&revision) {
            return Err(Error::new(
                "conflict",
                "Reminders changed. Refresh before applying this edit.",
            ));
        }
        let r = view
            .data
            .reminders
            .iter_mut()
            .find(|r| r.id == id)
            .ok_or_else(|| study::invalid("Reminder not found"))?;
        r.draft = draft;
        r.enabled = true;
        r.next_due = Some(due);
        r.pending_due = None;
        study::save(&root, &view.data, view.revision.as_deref())?;
        changed(&app, &vault_root);
        study::load(&root)
    })
    .await
}
#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReminderAction {
    Cancel,
    Dismiss,
    Snooze,
}
#[tauri::command]
pub async fn act_on_reminder(
    app: tauri::AppHandle,
    state: State<'_, Backend>,
    vault_root: String,
    id: String,
    action: ReminderAction,
    minutes: Option<i64>,
    revision: String,
) -> Result<study::View> {
    commands::work(&state, move |i| {
        let root = commands::root(i, &vault_root)?;
        let mut view = study::load(&root)?;
        if view.revision.as_deref() != Some(&revision) {
            return Err(Error::new(
                "conflict",
                "Reminders changed. Refresh and try again.",
            ));
        }
        let r = view
            .data
            .reminders
            .iter_mut()
            .find(|r| r.id == id)
            .ok_or_else(|| study::invalid("Reminder not found"))?;
        match action {
            ReminderAction::Cancel => {
                r.enabled = false;
                r.next_due = None;
                r.pending_due = None;
            }
            ReminderAction::Dismiss => {
                r.pending_due = None;
                if r.next_due.is_none() {
                    r.enabled = false;
                }
            }
            ReminderAction::Snooze => {
                let m = minutes.unwrap_or(10);
                if !(1..=1440).contains(&m) {
                    return Err(study::invalid("Snooze between 1 and 1440 minutes"));
                }
                r.next_due = Some(study::now() + m * 60);
                r.enabled = true;
                r.pending_due = None;
            }
        }
        study::save(&root, &view.data, view.revision.as_deref())?;
        changed(&app, &vault_root);
        study::load(&root)
    })
    .await
}
#[tauri::command]
pub async fn save_quiz_attempt(
    app: tauri::AppHandle,
    state: State<'_, Backend>,
    vault_root: String,
    quiz_id: String,
    attempt_id: String,
    answers: Vec<study::Answer>,
) -> Result<study::View> {
    commands::work(&state, move |i| {
        let root = commands::root(i, &vault_root)?;
        let mut view = study::load(&root)?;
        if view.data.attempts.iter().any(|a| a.id == attempt_id) {
            return Ok(view);
        }
        let quiz = view
            .data
            .quizzes
            .iter()
            .find(|q| q.id == quiz_id)
            .ok_or_else(|| study::invalid("Quiz not found"))?;
        let attempt = study::mark(quiz, &attempt_id, answers, study::now())?;
        view.data.attempts.push(attempt);
        study::save(&root, &view.data, view.revision.as_deref())?;
        changed(&app, &vault_root);
        study::load(&root)
    })
    .await
}
#[tauri::command]
pub fn test_reminder_notification(app: tauri::AppHandle) -> Result<()> {
    use tauri_plugin_notification::NotificationExt;
    app.notification().builder().title("Synapse reminders").body("Notifications are ready while Synapse is running").show().map_err(|_| Error::new("notification","Windows could not show the notification. Check notification settings and use the installed app."))
}
#[tauri::command]
pub fn close_synapse_window(app: tauri::AppHandle, quit: bool) -> Result<()> {
    let background = app
        .state::<Device>()
        .get()
        .map(|c| c.background)
        .unwrap_or(false);
    if !quit && background {
        if let Some(w) = app.get_webview_window("main") {
            w.hide()
                .map_err(|_| study::invalid("Unable to hide the window"))?;
        }
    } else {
        app.exit(0);
    }
    Ok(())
}
#[tauri::command]
pub fn startup_state(app: tauri::AppHandle) -> Result<bool> {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch()
        .is_enabled()
        .map_err(|_| Error::new("startup", "Unable to read Windows startup registration"))
}
#[tauri::command]
pub fn set_startup(app: tauri::AppHandle, enabled: bool) -> Result<bool> {
    use tauri_plugin_autostart::ManagerExt;
    if device::test_api_url().is_some() {
        return Err(Error::new(
            "startup",
            "Use the installed application to change startup behaviour",
        ));
    }
    let result = if enabled {
        app.autolaunch().enable()
    } else {
        app.autolaunch().disable()
    };
    result.map_err(|_| Error::new("startup", "Windows could not update startup registration"))?;
    startup_state(app)
}
