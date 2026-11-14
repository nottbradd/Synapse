use crate::{
    flashcards::{self, Rating},
    notes,
    organization::{self, Location},
    packages,
    subjects::Subject,
    transactions::{self, Journal},
    vault,
};
use std::{collections::BTreeMap, fs, io::Write, sync::atomic::AtomicBool};
fn write(root: &std::path::Path, path: &str, text: &str) {
    let p = root.join(path);
    fs::create_dir_all(p.parent().unwrap()).unwrap();
    fs::write(p, text).unwrap();
}
#[test]
fn legacy_membership_and_scoped_history_preserve_every_field() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().canonicalize().unwrap();
    write(&root, "Physics/a.md", "Term :: Definition");
    write(&root, "Methods/b.md", "Term :: Definition");
    write(&root, "orphan.md", "Unassigned");
    write(&root, "Custom/nested/c.md", "Custom note");
    write(
        &root,
        "Physics/override.md",
        "---\nsubject: spesh\n---\nNote",
    );
    let raw = flashcards::parse(
        &notes::parse("a.md", "Term :: Definition").unwrap(),
        "Term :: Definition",
    )[0]
    .id
    .clone();
    let review = flashcards::schedule(&raw, None, Rating::Easy, 123456);
    let old = serde_json::json!({"schema_version":1,"cards":{raw.clone():review}}).to_string();
    write(&root, "flashcards.json", &old);
    let s = vault::scan(&root).unwrap();
    assert_eq!(s.notes.len(), 5);
    assert_eq!(s.cards.len(), 2);
    assert_ne!(s.cards[0].subject_id, s.cards[1].subject_id);
    for c in &s.cards {
        let mut expected = review.clone();
        expected.card_id = c.id.clone();
        assert_eq!(s.history.cards[&c.id], expected);
    }
    assert_eq!(
        fs::read_to_string(root.join(".synapse/flashcards-v1-backup.json")).unwrap(),
        old
    );
    assert_eq!(
        fs::read_to_string(root.join("Physics/a.md")).unwrap(),
        "Term :: Definition"
    );
    let custom = s
        .notes
        .iter()
        .find(|n| n.id == "Custom/nested/c.md")
        .unwrap();
    assert_eq!(
        s.organization.subject(&custom.subject_id).unwrap().name,
        "Custom"
    );
    let override_note = s
        .notes
        .iter()
        .find(|n| n.id.ends_with("override.md"))
        .unwrap();
    assert_eq!(
        s.organization
            .subject(&override_note.subject_id)
            .unwrap()
            .preset,
        Subject::Specialist
    );
    let s2 = vault::scan(&root).unwrap();
    assert_eq!(s.cards[0].id, s2.cards[0].id);
}
#[test]
fn duplicate_names_managed_root_inference_and_assignment_are_stable() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().canonicalize().unwrap();
    vault::scan(&root).unwrap();
    let (mut o, rev) = organization::load(&root).unwrap();
    let a = o.new_neuron(&root, "VCE").unwrap();
    let b = o.new_neuron(&root, "University").unwrap();
    let sa = o
        .new_subject(&root, &a, "Physics", Subject::Physics, "#10b981")
        .unwrap();
    let sb = o
        .new_subject(&root, &b, "Physics", Subject::Physics, "#10b981")
        .unwrap();
    for id in [&sa, &sb] {
        write(
            &root,
            &format!("{}/a.md", o.subject(id).unwrap().root.as_ref().unwrap()),
            "---\nsubject: methods\n---\nQ: Shared\nA: Answer",
        );
    }
    organization::save(&root, &o, Some(&rev)).unwrap();
    let s = vault::scan(&root).unwrap();
    assert_eq!(s.cards.len(), 2);
    assert!(s.notes.iter().all(|n| n.subject == Subject::Physics));
    assert_ne!(s.cards[0].id, s.cards[1].id);
    let before: Vec<_> = s.cards.iter().map(|c| c.id.clone()).collect();
    let (mut o, rev) = organization::load(&root).unwrap();
    o.rename(&sa, "Mechanics").unwrap();
    o.assign(&sa, &b).unwrap();
    o.location = Location {
        neuron_id: Some(b),
        subject_id: Some(sa.clone()),
    };
    organization::save(&root, &o, Some(&rev)).unwrap();
    let s = vault::scan(&root).unwrap();
    assert_eq!(
        before,
        s.cards.iter().map(|c| c.id.clone()).collect::<Vec<_>>()
    );
    assert_eq!(s.organization.subject(&sa).unwrap().name, "Mechanics");
}
#[test]
fn malformed_metadata_is_never_replaced() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().canonicalize().unwrap();
    vault::scan(&root).unwrap();
    write(&root, ".synapse/organization.json", "{broken");
    assert!(vault::scan(&root).is_err());
    assert_eq!(
        fs::read_to_string(root.join(".synapse/organization.json")).unwrap(),
        "{broken"
    );
}

#[test]
fn renamed_legacy_custom_subject_owns_new_files_in_original_folder() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().canonicalize().unwrap();
    write(&root, "Research/old.md", "Old");
    let s = vault::scan(&root).unwrap();
    let id = s.notes[0].subject_id.clone();
    let (mut org, rev) = organization::load(&root).unwrap();
    org.rename(&id, "Networks").unwrap();
    organization::save(&root, &org, Some(&rev)).unwrap();
    write(&root, "Research/new.md", "New");
    let s = vault::scan(&root).unwrap();
    assert!(s.notes.iter().all(|n| n.subject_id == id));
}

#[test]
fn general_folder_and_explicit_general_do_not_create_duplicate_preset_subjects() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().canonicalize().unwrap();
    write(&root, "General/a.md", "General");
    write(
        &root,
        "Physics/b.md",
        "---\nsubject: general\n---\nUnassigned",
    );
    write(&root, "Physics/c.md", "Physics");
    let s = vault::scan(&root).unwrap();
    assert_eq!(s.organization.subjects.len(), 2);
    for path in ["General/a.md", "Physics/b.md"] {
        assert_eq!(
            s.notes.iter().find(|n| n.id == path).unwrap().subject_id,
            s.organization.fallback_subject
        );
    }
}

#[test]
fn unsupported_manifest_size_limits_and_attachment_escape_preserve_destination() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().canonicalize().unwrap();
    vault::scan(&root).unwrap();
    let original = fs::read(root.join(".synapse/organization.json")).unwrap();
    let src = tempfile::tempdir().unwrap();
    let source = src.path().canonicalize().unwrap();
    let cancel = AtomicBool::new(false);
    write(&source, "a.md", "![x](%2e%2e/outside.png)");
    assert!(packages::inspect(&root, &source, &cancel).is_err());
    write(&source, "a.md", "Valid :: Card");
    let mut plan = packages::inspect(&root, &source, &cancel).unwrap();
    plan.manifest.schema_version = 99;
    let out = root.join("future.synapse-subject");
    packages::write_export(&plan, &out).unwrap();
    assert!(packages::inspect(&root, &out, &cancel).is_err());
    let path = root.join("large.synapse-subject");
    let mut zip = zip::ZipWriter::new(fs::File::create(&path).unwrap());
    zip.start_file(
        "content/large.md",
        zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated),
    )
    .unwrap();
    let chunk = vec![b'a'; 1024 * 1024];
    for _ in 0..33 {
        zip.write_all(&chunk).unwrap();
    }
    zip.finish().unwrap();
    assert!(packages::inspect(&root, &path, &cancel).is_err());
    assert_eq!(
        original,
        fs::read(root.join(".synapse/organization.json")).unwrap()
    );
    assert_eq!(vault::scan(&root).unwrap().notes.len(), 0);
}

#[test]
fn empty_subject_roundtrip_does_not_require_notes_or_history() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().canonicalize().unwrap();
    let s = vault::scan(&root).unwrap();
    let cancel = AtomicBool::new(false);
    let plan =
        packages::prepare_export(&root, &s, &s.organization.fallback_subject, false, &cancel)
            .unwrap();
    assert_eq!(plan.preview().notes, 0);
    let path = root.join("empty.synapse-subject");
    packages::write_export(&plan, &path).unwrap();
    let plan = packages::inspect(&root, &path, &cancel).unwrap();
    packages::import(
        &root,
        &plan,
        &s.organization.neurons[0].id,
        "Empty copy",
        false,
        &cancel,
    )
    .unwrap();
    let next = vault::scan(&root).unwrap();
    assert_eq!(next.organization.subjects.len(), 2);
    assert!(next.cards.is_empty());
}
#[test]
fn package_roundtrip_preserves_links_assets_cards_and_explicit_history() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().canonicalize().unwrap();
    write(&root,"Physics/a.md","Q: See [[Physics/sub/b#Law|the law]]\nA: Answer\n\n![Figure](../shared/plot.svg)\n[[Methods/external#Part|other]]\n`[[ignored]]`");
    write(&root, "Physics/sub/b.md", "# Law\nMass :: Quantity");
    write(&root, "Methods/external.md", "External");
    write(&root, "shared/plot.svg", "<svg/>");
    write(&root, "shared/secret.env", "SECRET");
    let s = vault::scan(&root).unwrap();
    let sid = &s
        .notes
        .iter()
        .find(|n| n.id == "Physics/a.md")
        .unwrap()
        .subject_id;
    let c = s.cards.iter().find(|c| &c.subject_id == sid).unwrap();
    let mut h = s.history.clone();
    h.cards.insert(
        c.id.clone(),
        flashcards::schedule(&c.id, None, Rating::Good, 1000),
    );
    write(
        &root,
        "flashcards.json",
        &serde_json::to_string(&h).unwrap(),
    );
    let s = vault::scan(&root).unwrap();
    let cancel = AtomicBool::new(false);
    let plan = packages::prepare_export(&root, &s, sid, true, &cancel).unwrap();
    assert_eq!(plan.files.len(), 3);
    assert!(!plan
        .files
        .keys()
        .any(|p| p.contains("secret") || p.contains("Methods")));
    let out = root.join("export.synapse-subject");
    packages::write_export(&plan, &out).unwrap();
    let inspected = packages::inspect(&root, &out, &cancel).unwrap();
    assert_eq!(inspected.preview().external_count, 1);
    assert!(inspected.preview().has_history);
    let nid = &s.organization.neurons[0].id;
    let imported =
        packages::import(&root, &inspected, nid, "Physics copy", false, &cancel).unwrap();
    let after = vault::scan(&root).unwrap();
    assert_ne!(&imported, sid);
    let new_cards: Vec<_> = after
        .cards
        .iter()
        .filter(|c| c.subject_id == imported)
        .collect();
    assert_eq!(new_cards.len(), 2);
    assert!(new_cards
        .iter()
        .all(|c| !after.history.cards.contains_key(&c.id)));
    let imported_note = after
        .notes
        .iter()
        .find(|n| n.subject_id == imported && n.id.ends_with("Physics/a.md"))
        .unwrap();
    let text = vault::read(&root, &imported_note.id).unwrap().content;
    assert!(text.contains("#Law|the law]]"));
    assert!(text.contains("[[Methods/external#Part|other]]"));
    assert!(text.contains("`[[ignored]]`"));
    let external = after
        .links
        .iter()
        .find(|l| l.source == imported_note.id && l.raw.starts_with("Methods"))
        .unwrap();
    assert!(external.external);
    assert!(external.target.is_none());
    let original_keys: std::collections::BTreeSet<_> = s
        .cards
        .iter()
        .filter(|c| &c.subject_id == sid)
        .map(|c| c.content_id.clone())
        .collect();
    assert_eq!(
        original_keys,
        new_cards.iter().map(|c| c.content_id.clone()).collect()
    );
    let imported_history =
        packages::import(&root, &inspected, nid, "With progress", true, &cancel).unwrap();
    let after = vault::scan(&root).unwrap();
    assert!(after
        .history
        .cards
        .contains_key(&format!("{imported_history}:{}", c.content_id)));
    assert_eq!(after.history.cards[&c.id], h.cards[&c.id]);
    let fresh = packages::prepare_export(&root, &after, &imported, false, &cancel).unwrap();
    assert!(fresh.manifest.history.is_none());
}
#[test]
fn folder_preview_conflicts_and_cancellation_do_not_damage_files() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().canonicalize().unwrap();
    write(&root, "keep.md", "Original");
    let s = vault::scan(&root).unwrap();
    let src = tempfile::tempdir().unwrap();
    let source = src.path().canonicalize().unwrap();
    write(&source, "a.md", "[[sub/b#H|label]]\n[[missing]]");
    write(&source, "sub/b.md", "Term :: Answer");
    let no = AtomicBool::new(false);
    let yes = AtomicBool::new(true);
    assert!(packages::inspect(&root, &source, &yes).is_err());
    let plan = packages::inspect(&root, &source, &no).unwrap();
    assert_eq!(plan.preview().notes, 2);
    let metadata = fs::read(root.join(".synapse/organization.json")).unwrap();
    let nid = &s.organization.neurons[0].id;
    assert!(packages::import(&root, &plan, nid, "Canceled", false, &yes).is_err());
    assert!(packages::import(&root, &plan, "unknown", "Failure", false, &no).is_err());
    assert_eq!(
        metadata,
        fs::read(root.join(".synapse/organization.json")).unwrap()
    );
    assert_eq!(
        fs::read_to_string(root.join("keep.md")).unwrap(),
        "Original"
    );
    packages::import(&root, &plan, nid, "Imported", false, &no).unwrap();
    assert!(packages::import(&root, &plan, nid, "Imported", false, &no).is_err());
    let (o, _) = organization::load(&root).unwrap();
    assert_eq!(o.unique_name(nid, "Imported", None), "Imported (2)");
}
fn archive(root: &std::path::Path, entries: &[(&str, &[u8])]) -> std::path::PathBuf {
    let path = root.join(format!("{}.synapse-subject", organization::id()));
    let file = fs::File::create(&path).unwrap();
    let mut z = zip::ZipWriter::new(file);
    for (name, data) in entries {
        z.start_file(*name, zip::write::SimpleFileOptions::default())
            .unwrap();
        z.write_all(data).unwrap();
    }
    z.finish().unwrap();
    path
}
#[test]
fn hostile_archives_are_rejected_before_publication() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().canonicalize().unwrap();
    vault::scan(&root).unwrap();
    let cancel = AtomicBool::new(false);
    for name in [
        "../escape.md",
        "/absolute.md",
        "C:/drive.md",
        "content/../escape.md",
        "content/a\\b.md",
        "content/CON.md",
        "content/a./b.md",
        "content/.synapse/x.md",
    ] {
        let path = archive(&root, &[("manifest.json", b"{}"), (name, b"bad")]);
        assert!(packages::inspect(&root, &path, &cancel).is_err(), "{name}");
    }
    for entries in [
        vec![("content/a.md", b"a".as_slice()), ("content/A.md", b"b")],
        vec![
            ("content/a/x.md", b"a".as_slice()),
            ("content/A/y.md", b"b"),
        ],
        vec![("content/a", b"a".as_slice()), ("content/a/x.md", b"b")],
    ] {
        let path = archive(&root, &entries);
        assert!(packages::inspect(&root, &path, &cancel).is_err());
    }
    let path = root.join("symlink.synapse-subject");
    let mut z = zip::ZipWriter::new(fs::File::create(&path).unwrap());
    z.add_symlink(
        "content/a.md",
        "../../escape",
        zip::write::SimpleFileOptions::default(),
    )
    .unwrap();
    z.finish().unwrap();
    assert!(packages::inspect(&root, &path, &cancel).is_err());
    assert_eq!(vault::scan(&root).unwrap().notes.len(), 0);
}
#[test]
fn publication_recovery_is_idempotent_and_preserves_external_edits() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().canonicalize().unwrap();
    let s = vault::scan(&root).unwrap();
    let meta = organization::area(&root).unwrap();
    write(&meta, "import-test/a.md", "Restored");
    let org = fs::read_to_string(meta.join("organization.json")).unwrap();
    let j = Journal {
        schema_version: 1,
        stage: "import-test".into(),
        destination: "Recovered".into(),
        files: BTreeMap::from([("a.md".into(), transactions::digest(b"Restored"))]),
        organization_before: org.clone(),
        organization_after: org,
        history_before: None,
        history_after: serde_json::to_string(&s.history).unwrap(),
    };
    write(
        &meta,
        "pending-import.json",
        &serde_json::to_string(&j).unwrap(),
    );
    transactions::recover(&root).unwrap();
    transactions::recover(&root).unwrap();
    assert_eq!(
        fs::read_to_string(root.join("Recovered/a.md")).unwrap(),
        "Restored"
    );
    write(
        &meta,
        "pending-import.json",
        &serde_json::to_string(&j).unwrap(),
    );
    write(&root, "flashcards.json", "External edit");
    assert!(transactions::recover(&root).is_err());
    assert_eq!(
        fs::read_to_string(root.join("flashcards.json")).unwrap(),
        "External edit"
    );
}
