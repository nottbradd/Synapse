use crate::{
    flashcards::{self, Rating},
    links, notes,
    subjects::Subject,
    vault,
};
use std::{collections::HashMap, fs};
#[test]
fn frontmatter_and_subject_precedence() {
    let n = notes::parse(
        "Methods/例.md",
        "---\r\ntitle: 'A: title'\r\nsubject: SPESH\r\n---\r\nText",
    )
    .unwrap();
    assert_eq!(n.title, "A: title");
    assert_eq!(n.subject, Subject::Specialist);
    assert_eq!(
        notes::parse("Physics/a.md", "---\nsubject: unknown\n---\n")
            .unwrap()
            .subject,
        Subject::Physics
    );
    assert!(notes::parse("a.md", "---\ntitle: [\n---\n").is_err());
    assert!(notes::parse("a.md", "---\ntitle: a").is_err());
}
#[test]
fn wiki_resolution_ambiguity_and_code() {
    let mut ns = vec![
        notes::parse("a.md", "").unwrap(),
        notes::parse("Physics/a.md", "").unwrap(),
        notes::parse("b.md", "").unwrap(),
    ];
    assert_eq!(links::resolve("a", "b.md", &ns).len(), 2);
    assert_eq!(links::resolve("./a", "b.md", &ns), vec!["a.md"]);
    assert_eq!(links::resolve("./A.MD", "b.md", &ns), vec!["a.md"]);
    assert_eq!(
        links::resolve("Physics/a#Heading|A", "b.md", &ns),
        vec!["Physics/a.md"]
    );
    let contents=HashMap::from([("b.md".into(),"[[a]] [[missing]] [[Physics/a|A]] [[Physics/a#heading]] `[[not-real]]`\n```md\n[[no]]\n```".into())]);
    let (ls, es) = links::build(&mut ns, &contents);
    assert_eq!(ls.len(), 4);
    assert_eq!(es.len(), 1);
    assert_eq!(ls[0].candidates.len(), 2);
    assert!(ls[1].target.is_none());
    assert_eq!(
        ns.iter().map(|n| n.neighbors).collect::<Vec<_>>(),
        vec![0, 1, 1]
    );
}
#[test]
fn vault_graph_counts_unique_pairs_across_titles_paths_and_reverse_references() {
    let mut notes = vec![
        notes::parse("One/a.md", "---\ntitle: Alpha\n---\n").unwrap(),
        notes::parse("Two/b.md", "").unwrap(),
        notes::parse("Loose.md", "").unwrap(),
    ];
    let content = HashMap::from([
        (
            "One/a.md".into(),
            "[[b]] [[./Two/B.MD#section|alias]] [[alpha]]".into(),
        ),
        ("Two/b.md".into(), "[[AlPhA]] [[One/a]] [[missing]]".into()),
    ]);
    let (resolved, edges) = links::build(&mut notes, &content);
    assert_eq!(resolved.len(), 6);
    assert_eq!(edges.len(), 1);
    assert_eq!(
        (&*edges[0].source, &*edges[0].target),
        ("One/a.md", "Two/b.md")
    );
    assert_eq!(
        notes.iter().map(|n| n.neighbors).collect::<Vec<_>>(),
        vec![1, 1, 0]
    );
}
#[test]
fn flashcard_parsing_and_identity() {
    let text="---\ntitle: 'Fake :: No'\n---\nQ: What is $F$?\nA: Force.\nMeasured in newtons.\n\nTerm :: **Definition**\n`No :: Code`\n```\nBad :: card\n```\n$$x :: y$$\n$z :: w$\n";
    let n = notes::parse("Physics/n.md", text).unwrap();
    let cards = flashcards::parse(&n, text);
    assert_eq!(cards.len(), 2);
    assert!(cards[0].answer.contains("newtons"));
    let moved = notes::parse("other.md", text).unwrap();
    assert_eq!(cards[0].id, flashcards::parse(&moved, text)[0].id);
    assert_ne!(
        cards[0].id,
        flashcards::parse(&n, &text.replace("Force.", "A force."))[0].id
    );
    assert_eq!(
        flashcards::parse(&n, "Term :: Definition\nTerm :: Definition").len(),
        1
    );
}
#[test]
fn schedule_and_metadata_roundtrip() {
    let again = flashcards::schedule("card", None, Rating::Again, 1000);
    let hard = flashcards::schedule("card", None, Rating::Hard, 1000);
    let good = flashcards::schedule("card", None, Rating::Good, 1000);
    let easy = flashcards::schedule("card", None, Rating::Easy, 1000);
    assert_eq!(again.due, 1060);
    assert!(again.due < hard.due && hard.due < good.due && good.due < easy.due);
    assert_eq!(again.lapses, 1);
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().canonicalize().unwrap();
    let mut h = flashcards::History::default();
    h.cards.insert("card".into(), good.clone());
    vault::atomic_write(
        &root,
        "flashcards.json",
        &serde_json::to_string(&h).unwrap(),
        None,
        false,
    )
    .unwrap();
    assert_eq!(flashcards::load(&root).unwrap().0.cards["card"], good);
    fs::write(root.join("flashcards.json"), "{broken").unwrap();
    assert!(flashcards::load(&root).is_err());
    assert_eq!(
        fs::read_to_string(root.join("flashcards.json")).unwrap(),
        "{broken"
    );
}
#[test]
fn recall_locations_share_canonical_recognition_without_changing_identity() {
    let text = "\u{feff}---\r\ntitle: 'Hidden :: metadata'\r\n---\r\n# A note 🧠\r\n\r\nOrdinary prose: an answer.\r\n`No :: code`\r\n```md\r\nQ: Not a card\r\nA: Code\r\n```\r\n$$\r\nQ: Math\r\nA: Not a card\r\n$$\r\n\r\nQ: What is $F$?\r\nA: **Force** and [[Impulse]].\r\nMeasured in newtons.\r\n\r\nTerm :: Definition\r\nTerm :: Definition\r\n";
    let note = notes::parse("Physics/n.md", text).unwrap();
    let cards = flashcards::parse(&note, text);
    let presentation = flashcards::presentation(text).unwrap();
    assert_eq!(cards.len(), 2);
    assert_eq!(presentation.recalls.len(), 3); // Every occurrence is concealed; reviews remain deduplicated.
    let utf16: Vec<_> = presentation.body.encode_utf16().collect();
    let ranges: Vec<_> = presentation
        .recalls
        .iter()
        .map(|b| String::from_utf16(&utf16[b.start..b.end]).unwrap())
        .collect();
    assert_eq!(
        ranges[0],
        "Q: What is $F$?\r\nA: **Force** and [[Impulse]].\r\nMeasured in newtons."
    );
    assert_eq!(&ranges[1..], &["Term :: Definition", "Term :: Definition"]);
    assert_eq!(presentation.recalls[0].content_id, cards[0].content_id);
    assert_eq!(presentation.recalls[0].question, cards[0].question);
    assert_eq!(presentation.recalls[0].answer, cards[0].answer);
    assert_eq!(
        cards[0].id,
        notes::hash("What is $F$?\0**Force** and [[Impulse]]. Measured in newtons.")
    );
    assert_eq!(
        presentation.recalls[1].content_id,
        presentation.recalls[2].content_id
    );
    assert!(presentation.body.contains("Ordinary prose"));
    assert!(!presentation.body.contains("Hidden :: metadata"));
}

#[test]
fn rating_previews_are_read_only_and_match_commits_at_one_fixed_time() {
    let now = 1_700_000_000;
    for old in [
        None,
        Some(flashcards::Review {
            card_id: "card".into(),
            last_review: now - 86400,
            due: now - 1,
            interval: 7.4,
            ease: 2.2,
            reviews: 8,
            lapses: 2,
        }),
    ] {
        for rating in [Rating::Again, Rating::Hard, Rating::Good, Rating::Easy] {
            let temp = tempfile::tempdir().unwrap();
            let root = temp.path().canonicalize().unwrap();
            if let Some(old) = &old {
                let mut history = flashcards::History::default();
                history.cards.insert("card".into(), old.clone());
                fs::write(
                    root.join("flashcards.json"),
                    serde_json::to_string_pretty(&history).unwrap(),
                )
                .unwrap();
            }
            let before = fs::read(root.join("flashcards.json")).ok();
            let preview = flashcards::preview_at(&root, "card", now).unwrap();
            assert_eq!(preview.reference_time, now);
            assert_eq!(preview.options.len(), 4);
            assert_eq!(fs::read(root.join("flashcards.json")).ok(), before);
            let selected = preview
                .options
                .iter()
                .find(|p| std::mem::discriminant(&p.rating) == std::mem::discriminant(&rating))
                .unwrap();
            let committed = flashcards::rate_at(&root, "card", rating, now).unwrap();
            assert_eq!(selected.due, committed.due);
            assert_eq!(selected.interval_seconds, committed.due - now);
            assert_eq!(flashcards::load(&root).unwrap().0.cards["card"], committed);
            assert_eq!(committed.reviews, old.as_ref().map_or(1, |r| r.reviews + 1));
        }
    }
}

#[test]
fn preview_preserves_corrupt_and_legacy_history() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap();
    for text in ["{broken", "{\"schema_version\":1,\"cards\":{}}"] {
        fs::write(root.join("flashcards.json"), text).unwrap();
        let result = flashcards::preview_at(&root, "card", 1000);
        assert_eq!(result.is_ok(), text.contains("schema_version"));
        assert_eq!(
            fs::read_to_string(root.join("flashcards.json")).unwrap(),
            text
        );
        assert!(!root.join(".synapse").exists());
    }
}
#[test]
fn containment_conflicts_and_unicode() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().canonicalize().unwrap();
    for bad in [
        "../escape.md",
        "C:\\escape.md",
        "/absolute.md",
        "a/../b.md",
        "a:stream.md",
        ".git/a.md",
        "CON.md",
        "a./x.md",
        "a//x.md",
    ] {
        assert!(vault::contained(&root, bad, true).is_err(), "{bad}");
    }
    let id = "Physics/磁場 notes.md";
    vault::atomic_write(&root, id, "original", None, true).unwrap();
    let doc = vault::read(&root, id).unwrap();
    fs::write(root.join(id), "external").unwrap();
    assert!(vault::atomic_write(&root, id, "mine", Some(&doc.revision), true).is_err());
    assert_eq!(vault::read(&root, id).unwrap().content, "external");
    let revision = notes::hash("external");
    vault::atomic_write(&root, id, "mine", Some(&revision), true).unwrap();
    assert_eq!(vault::read(&root, id).unwrap().content, "mine");
    assert!(vault::atomic_write(&root, id, "new", None, true).is_err());
}
#[cfg(windows)]
#[test]
fn junction_escape_is_rejected() {
    let tmp = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let root = tmp.path().canonicalize().unwrap();
    // Windows symlink privileges vary; junctions are unprivileged and exercise canonical containment.
    let output = std::process::Command::new("cmd")
        .args(["/c", "mklink", "/J"])
        .arg(root.join("escape"))
        .arg(outside.path())
        .output()
        .unwrap();
    assert!(output.status.success());
    assert!(vault::contained(&root, "escape/n.md", true).is_err());
    fs::remove_dir(root.join("escape")).unwrap();
}
#[test]
fn synthetic_500_note_scan() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().canonicalize().unwrap();
    for i in 0..500 {
        fs::write(
            root.join(format!("{i}.md")),
            format!(
                "---\nsubject: physics\n---\n[[{}]]\nTerm {i} :: Definition {i}",
                (i + 1) % 500
            ),
        )
        .unwrap();
    }
    let start = std::time::Instant::now();
    let snapshot = vault::scan(&root).unwrap();
    println!("500-note scan: {:?}", start.elapsed());
    assert_eq!(snapshot.notes.len(), 500);
    assert_eq!(snapshot.edges.len(), 500);
    assert_eq!(snapshot.cards.len(), 500);
}
