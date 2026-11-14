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
