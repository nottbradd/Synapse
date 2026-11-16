use crate::{
    ai::{self, DraftOrigin, Kind},
    commands::Backend,
    device::{self, CredentialStore},
    organization, packages,
    study::*,
    study_commands::{persist_flashcards, FlashcardDestination},
    study_transfer, vault,
};
use chrono::DateTime;
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::Path,
    sync::atomic::AtomicBool,
};

fn fixture() -> (tempfile::TempDir, std::path::PathBuf, vault::Snapshot) {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap();
    fs::create_dir(root.join("Physics")).unwrap();
    fs::write(
        root.join("Physics/momentum.md"),
        "# Momentum\n\nMomentum is mass times velocity.\n\nQ: Existing?\nA: Preserved\n",
    )
    .unwrap();
    fs::write(
        root.join("Physics/destination.md"),
        "# Destination\n\nOriginal text\n",
    )
    .unwrap();
    let snapshot = vault::scan(&root).unwrap();
    (temp, root, snapshot)
}
fn quiz(context: &ai::Context) -> Quiz {
    let source = context.sources[0].source.clone();
    Quiz {
        id: id(),
        subject_id: source.subject_id.clone(),
        created_at: now(),
        sources: vec![source.clone()],
        draft: QuizDraft {
            title: "Momentum".into(),
            questions: vec![
                Question {
                    id: id(),
                    kind: QuestionKind::MultipleChoice,
                    prompt: "Momentum of 2 kg at 3 m/s?".into(),
                    options: vec!["6 kg m/s".into(), "5 kg m/s".into()],
                    correct_index: Some(0),
                    answer: "6 kg m/s".into(),
                    explanation: "Multiply mass by velocity".into(),
                    sources: vec![source.id.clone()],
                },
                Question {
                    id: id(),
                    kind: QuestionKind::ShortAnswer,
                    prompt: "Explain the direction of momentum".into(),
                    options: vec![],
                    correct_index: None,
                    answer: "Momentum has the direction of velocity".into(),
                    explanation: "Mass is a scalar".into(),
                    sources: vec![source.id],
                },
            ],
        },
    }
}
fn context(snapshot: &vault::Snapshot) -> ai::Context {
    ai::prepare(snapshot, &["Physics/momentum.md".into()], Kind::Quiz).unwrap()
}
fn reminder(local: &str) -> ReminderDraft {
    ReminderDraft {
        title: "Revise momentum".into(),
        local_at: local.into(),
        timezone: "Australia/Sydney".into(),
        repetition: Repetition::None,
        source_id: None,
        subject_id: None,
        fold: None,
        clarification: None,
    }
}
fn ts(iso: &str) -> i64 {
    DateTime::parse_from_rfc3339(iso).unwrap().timestamp()
}
fn put(root: &Path, store: &Store) {
    let v = load(root).unwrap();
    save(root, store, v.revision.as_deref()).unwrap();
}

#[test]
fn quiz_validation_rejects_unknown_sources_duplicate_ids_and_invalid_options() {
    let (_t, _, s) = fixture();
    let c = context(&s);
    let q = quiz(&c);
    let allowed = c.ids();
    validate_quiz(&q.draft, &allowed).unwrap();
    let mut invalid = q.draft.clone();
    invalid.questions[0].correct_index = Some(2);
    assert!(validate_quiz(&invalid, &allowed).is_err());
    invalid = q.draft.clone();
    invalid.questions[0].sources = vec!["secret.md".into()];
    assert!(validate_quiz(&invalid, &allowed).is_err());
    invalid = q.draft.clone();
    invalid.questions[1].id = invalid.questions[0].id.clone();
    assert!(validate_quiz(&invalid, &allowed).is_err());
    invalid = q.draft.clone();
    invalid.questions[1].options = vec!["not a choice question".into()];
    assert!(validate_quiz(&invalid, &allowed).is_err());
    invalid = q.draft.clone();
    invalid.questions[0].options = vec!["same".into(), " SAME ".into()];
    assert!(validate_quiz(&invalid, &allowed).is_err());
}
#[test]
fn offline_marking_is_deterministic_and_short_answers_require_self_assessment() {
    let (_t, root, s) = fixture();
    let q = quiz(&context(&s));
    let answers = vec![
        Answer {
            question_id: q.draft.questions[0].id.clone(),
            option: Some(0),
            response: String::new(),
            self_assessed: None,
        },
        Answer {
            question_id: q.draft.questions[1].id.clone(),
            option: None,
            response: "In the velocity direction".into(),
            self_assessed: Some(true),
        },
    ];
    let a = mark(&q, &id(), answers.clone(), now()).unwrap();
    assert_eq!((a.correct, a.total), (2, 2));
    let mut missing = answers.clone();
    missing[1].self_assessed = None;
    assert!(mark(&q, &id(), missing, now()).is_err());
    let mut store = Store::default();
    store.quizzes.push(q);
    store.attempts.push(a);
    put(&root, &store);
    let restored = load(&root).unwrap();
    assert_eq!(restored.data.attempts[0].correct, 2);
    assert!(!root.join("flashcards.json").exists());
    store.attempts[0].correct = 0;
    assert!(validate(&store).is_err());
}
#[test]
fn source_preview_sends_only_selected_body_and_reports_whole_note_exclusions() {
    let (_t, root, s) = fixture();
    let c = context(&s);
    assert_eq!(c.sources.len(), 1);
    assert!(c.sources[0].content.contains("Momentum"));
    let raw = serde_json::to_string(&c).unwrap();
    assert!(!raw.contains(&s.root));
    assert!(!raw.contains("Original text"));
    fs::write(root.join("Physics/momentum.md"), "x".repeat(MAX_NOTE + 1)).unwrap();
    let c = context(&s);
    assert!(c.sources.is_empty());
    assert_eq!(c.excluded.len(), 1);
    let r = ai::prepare(&s, &["Physics/momentum.md".into()], Kind::Reminder).unwrap();
    assert!(r.sources[0].content.is_empty());
    assert!(ai::prepare(&s, &["../outside.md".into()], Kind::Quiz).is_err());
    assert!(ai::prepare(&s, &vec!["Physics/momentum.md".into(); 21], Kind::Quiz).is_err());
}
#[test]
fn cancelling_and_switching_scope_invalidate_request_origins() {
    let (_t, root, s) = fixture();
    let c = context(&s);
    let state = ai::AiState::default();
    state.remember(c.clone()).unwrap();
    let token = tokio_util::sync::CancellationToken::new();
    let request = id();
    {
        let mut requests = state.0.lock().unwrap();
        requests.running.insert(request.clone(), token.clone());
        requests.drafts.insert(
            request.clone(),
            DraftOrigin {
                context: c.clone(),
                kind: Kind::Quiz,
            },
        );
    }
    state.cancel(Some(&request));
    assert!(token.is_cancelled());
    assert!(state.origin(&request).is_err());
    let backend = Backend::default();
    {
        let mut b = backend.0.lock().unwrap();
        b.root = Some(root);
        b.snapshot = Some(s);
    }
    c.check(&backend).unwrap();
    backend
        .0
        .lock()
        .unwrap()
        .snapshot
        .as_mut()
        .unwrap()
        .organization
        .location
        .subject_id = Some(id());
    assert!(c.check(&backend).is_err());
    state.cancel(None);
    assert!(state.context(&c.token).is_err());
}
#[test]
fn flashcard_save_is_idempotent_canonical_and_never_reviews_or_overwrites_sources() {
    let (_t, root, s) = fixture();
    let c = ai::prepare(&s, &["Physics/momentum.md".into()], Kind::Flashcards).unwrap();
    let original = fs::read(root.join("Physics/momentum.md")).unwrap();
    let origin = DraftOrigin {
        context: c.clone(),
        kind: Kind::Flashcards,
    };
    let request = id();
    let draft = FlashcardDraft {
        title: "Momentum recall".into(),
        cards: vec![CardDraft {
            question: "What is $p$?".into(),
            answer: "$p = mv$, in the direction of [[velocity]]".into(),
            sources: c.ids().into_iter().collect(),
        }],
    };
    let dest = || FlashcardDestination {
        subject_id: c.sources[0].source.subject_id.clone(),
        note_id: None,
        new_path: "Recall.md".into(),
        revision: None,
    };
    let (note, _) =
        persist_flashcards(&root, request.clone(), draft.clone(), dest(), &origin, &s).unwrap();
    let first = fs::read(root.join(&note)).unwrap();
    persist_flashcards(&root, request.clone(), draft.clone(), dest(), &origin, &s).unwrap();
    assert_eq!(first, fs::read(root.join(&note)).unwrap());
    // Simulate an interrupted publication after Markdown but before metadata.
    let mut partial = load(&root).unwrap();
    partial.data.receipts.clear();
    partial.data.flashcard_batches.clear();
    save(&root, &partial.data, partial.revision.as_deref()).unwrap();
    let mut changed = draft.clone();
    changed.cards[0].answer = "Edited after the partial save".into();
    assert!(persist_flashcards(&root, request.clone(), changed, dest(), &origin, &s).is_err());
    persist_flashcards(&root, request.clone(), draft.clone(), dest(), &origin, &s).unwrap();
    assert_eq!(first, fs::read(root.join(&note)).unwrap());
    assert_eq!(
        original,
        fs::read(root.join("Physics/momentum.md")).unwrap()
    );
    assert!(!root.join("flashcards.json").exists());
    let current = vault::scan(&root).unwrap();
    assert_eq!(current.cards.len(), 2);
    assert!(current
        .edges
        .iter()
        .any(|e| (e.source == note && e.target == "Physics/momentum.md")
            || (e.target == note && e.source == "Physics/momentum.md")));
    assert_eq!(load(&root).unwrap().data.flashcard_batches.len(), 1);
    let mut protected = dest();
    protected.note_id = Some("Physics/momentum.md".into());
    protected.revision = Some(c.sources[0].source.revision.clone());
    assert!(persist_flashcards(&root, id(), draft.clone(), protected, &origin, &s).is_err());
    let mut conflict = dest();
    conflict.note_id = Some("Physics/destination.md".into());
    conflict.revision = Some("wrong".into());
    assert!(persist_flashcards(&root, id(), draft, conflict, &origin, &s).is_err());
    assert!(String::from_utf8(first)
        .unwrap()
        .contains("Q: What is $p$?\nA: $p = mv$"));
}
#[test]
fn flashcard_markers_and_multicard_injection_cannot_corrupt_canonical_format() {
    let allowed = BTreeSet::from(["a.md".into()]);
    for (question, answer) in [
        ("bad\nA: injection", "answer"),
        ("question", "answer\n\nQ: extra\nA: hidden"),
        ("question", "answer\n---\nQ: extra\nA: hidden"),
    ] {
        let draft = FlashcardDraft {
            title: "Test".into(),
            cards: vec![CardDraft {
                question: question.into(),
                answer: answer.into(),
                sources: vec!["a.md".into()],
            }],
        };
        assert!(validate_cards(&draft, &allowed).is_err());
    }
}
#[test]
fn reminder_dates_require_clarification_for_dst_gaps_folds_and_past_times() {
    assert!(resolve_reminder(&reminder("2026-10-04T02:30"), 0, true).is_err());
    let mut fold = reminder("2026-04-05T02:30");
    assert!(resolve_reminder(&fold, 0, true).is_err());
    fold.fold = Some("earlier".into());
    let earlier = resolve_reminder(&fold, 0, true).unwrap().due;
    fold.fold = Some("later".into());
    assert_eq!(
        resolve_reminder(&fold, 0, true).unwrap().due - earlier,
        3600
    );
    assert!(resolve_reminder(
        &reminder("2026-01-01T18:00"),
        ts("2026-01-02T00:00:00Z"),
        true
    )
    .is_err());
    let mut ambiguous = reminder("2027-01-01T18:00");
    ambiguous.clarification = Some("Which day?".into());
    assert!(resolve_reminder(&ambiguous, 0, true).is_err());
}
#[test]
fn recurrence_retains_local_wall_time_through_dst_and_skips_missed_occurrences() {
    let mut daily = reminder("2026-10-03T18:00");
    daily.repetition = Repetition::Daily;
    let first = resolve_reminder(&daily, 0, true).unwrap().due;
    let next = next_occurrence(&daily, first).unwrap().unwrap();
    assert_eq!(next - first, 23 * 3600);
    let late = ts("2026-10-10T08:00:00Z");
    assert_eq!(
        next_occurrence(&daily, late).unwrap(),
        Some(ts("2026-10-11T07:00:00Z"))
    );
    daily.local_at = "2026-10-03T02:30".into();
    let next = next_occurrence(&daily, ts("2026-10-02T16:30:00Z"))
        .unwrap()
        .unwrap();
    assert_eq!(next, ts("2026-10-03T16:00:00Z"));
    daily.repetition = Repetition::Weekly;
    daily.local_at = "2026-10-03T18:00".into();
    assert_eq!(
        next_occurrence(&daily, first).unwrap(),
        Some(ts("2026-10-10T07:00:00Z"))
    );
}
#[test]
fn durable_reminders_catch_up_once_and_clock_rollback_does_not_redeliver() {
    let (_t, root, _) = fixture();
    let d = reminder("2026-11-16T18:00");
    let due = resolve_reminder(&d, 0, true).unwrap().due;
    let mut store = Store::default();
    store.reminders.push(Reminder {
        id: id(),
        draft: d,
        enabled: true,
        next_due: Some(due),
        pending_due: None,
        last_delivered: None,
        created_at: due - 100,
    });
    put(&root, &store);
    assert!(advance(&mut store, due - 1).unwrap().is_empty());
    assert_eq!(advance(&mut store, due + 86400).unwrap().len(), 1);
    put(&root, &store);
    let mut restarted = load(&root).unwrap().data;
    assert_eq!(restarted.reminders[0].pending_due, Some(due));
    assert!(advance(&mut restarted, due + 86401).unwrap().is_empty());
    assert!(advance(&mut restarted, due - 86400).unwrap().is_empty());
}
#[test]
fn invalid_metadata_and_external_edits_are_preserved() {
    let (_t, root, s) = fixture();
    let mut store = Store::default();
    store.quizzes.push(quiz(&context(&s)));
    put(&root, &store);
    let stale = load(&root).unwrap();
    let path = organization::area(&root).unwrap().join("study.json");
    fs::write(&path, "invalid study data").unwrap();
    assert!(load(&root).is_err());
    assert!(save(&root, &store, stale.revision.as_deref()).is_err());
    assert_eq!(fs::read_to_string(path).unwrap(), "invalid study data");
    store.quizzes[0].sources[0].id = "../private.md".into();
    assert!(validate(&store).is_err());
}
#[test]
fn packages_preserve_study_content_pause_reminders_and_opt_in_attempts() {
    let (_t, root, s) = fixture();
    let c = context(&s);
    let q = quiz(&c);
    let sid = q.subject_id.clone();
    let a = mark(
        &q,
        &id(),
        vec![
            Answer {
                question_id: q.draft.questions[0].id.clone(),
                option: Some(0),
                response: String::new(),
                self_assessed: None,
            },
            Answer {
                question_id: q.draft.questions[1].id.clone(),
                option: None,
                response: "velocity".into(),
                self_assessed: Some(true),
            },
        ],
        now(),
    )
    .unwrap();
    let mut r = reminder("2027-01-01T18:00");
    r.subject_id = Some(sid.clone());
    r.source_id = Some("Physics/momentum.md".into());
    let mut store = Store::default();
    store.quizzes.push(q);
    store.attempts.push(a);
    store.reminders.push(Reminder {
        id: id(),
        draft: r,
        enabled: true,
        next_due: Some(ts("2027-01-01T07:00:00Z")),
        pending_due: None,
        last_delivered: None,
        created_at: now(),
    });
    put(&root, &store);
    let mapping = BTreeMap::from([("Physics/momentum.md".into(), "momentum.md".into())]);
    let p = study_transfer::export(&store, &sid, &mapping, false)
        .unwrap()
        .unwrap();
    assert!(p.attempts.is_empty());
    assert!(!p.reminders[0].enabled);
    let mut imported = Store::default();
    let next_sid = id();
    study_transfer::import(
        &mut imported,
        &p,
        &next_sid,
        "Imported",
        &["momentum.md".into()],
        false,
    )
    .unwrap();
    assert_eq!(imported.quizzes[0].sources[0].id, "Imported/momentum.md");
    assert_ne!(imported.quizzes[0].id, store.quizzes[0].id);
    assert!(imported.receipts.is_empty());
    let cancel = AtomicBool::new(false);
    let plan = packages::prepare_export(&root, &s, &sid, true, &cancel).unwrap();
    assert_eq!(plan.manifest.schema_version, 2);
    assert_eq!(plan.preview().quiz_attempts, 1);
    let nid = s.organization.neurons[0].id.clone();
    let imported_sid =
        packages::import(&root, &plan, &nid, "Imported study", true, &cancel).unwrap();
    let restored = load(&root).unwrap();
    assert!(restored
        .data
        .quizzes
        .iter()
        .any(|q| q.subject_id == imported_sid));
    assert_eq!(restored.data.attempts.len(), 2);
    assert!(!restored.data.reminders[1].enabled);
    let serialized = serde_json::to_string(&plan.manifest).unwrap();
    for forbidden in ["reminder_vaults", "input_tokens", "api_key", "receipts"] {
        assert!(!serialized.contains(forbidden));
    }
}
#[test]
fn api_errors_never_echo_server_text_or_secret_and_device_config_has_no_key() {
    for status in [400, 401, 403, 404, 429, 500] {
        let error = ai::api_error(
            status,
            &serde_json::json!({"error":{"message":"sk-private-key SECRET NOTE","code":"insufficient_quota"}}),
        );
        assert!(!error.message.contains("sk-private"));
        assert!(!error.message.contains("SECRET NOTE"));
    }
    assert!(device::OsCredential.write("short secret").is_err());
    let temp = tempfile::tempdir().unwrap();
    let d = device::Device::new(temp.path().into()).unwrap();
    d.usage(20, 10).unwrap();
    let raw = fs::read_to_string(temp.path().join("device.json")).unwrap();
    assert!(!raw.contains("key"));
    assert!(raw.contains("input_tokens"));
    fs::write(temp.path().join("device.json"), "broken").unwrap();
    let d = device::Device::new(temp.path().into()).unwrap();
    assert!(d.get().is_err());
    assert!(d.usage(1, 1).is_err());
}
#[cfg(target_os = "windows")]
#[test]
fn windows_credential_roundtrip_uses_a_separate_temporary_entry() {
    let entry = keyring::Entry::new("com.synapse.study.tests", &id()).unwrap();
    entry
        .set_password("synthetic-test-credential-only")
        .unwrap();
    let recovered = zeroize::Zeroizing::new(entry.get_password().unwrap());
    assert_eq!(recovered.as_str(), "synthetic-test-credential-only");
    entry.delete_credential().unwrap();
    assert!(matches!(entry.get_password(), Err(keyring::Error::NoEntry)));
}
#[tokio::test(flavor = "current_thread")]
#[ignore = "Explicit bounded live check; no user notes are sent"]
async fn configured_api_integration_check() {
    let Some(key) = device::OsCredential.read().unwrap() else {
        println!("Live API verification pending: no configured credential");
        return;
    };
    let temp = tempfile::tempdir().unwrap();
    let d = device::Device::new(temp.path().into()).unwrap();
    let response=ai::post(&d.client,&key,serde_json::json!({"model":"gpt-5.4-mini","store":false,"reasoning":{"effort":"none"},"max_output_tokens":128,"input":"Reply with OK"}),&tokio_util::sync::CancellationToken::new()).await.unwrap();
    assert_eq!(response["status"], "completed");
    println!(
        "Bounded live Responses check completed; usage {}",
        response["usage"]
    );
}
