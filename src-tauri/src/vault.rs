use crate::{
    errors::{Error, Result},
    flashcards::{self, Card, History},
    links::{self, Edge, WikiLink},
    notes::{self, Note},
};
use serde::Serialize;
use std::{
    collections::HashMap,
    io::Write,
    path::{Component, Path, PathBuf},
};
use walkdir::WalkDir;
pub const IGNORED: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".synapse",
    ".obsidian",
    ".trash",
];
#[derive(Debug, Clone, Serialize)]
pub struct Snapshot {
    pub root: String,
    pub name: String,
    pub notes: Vec<Note>,
    pub links: Vec<WikiLink>,
    pub edges: Vec<Edge>,
    pub cards: Vec<Card>,
    pub history: History,
    pub warnings: Vec<String>,
    pub review_error: Option<String>,
}
pub fn contained(root: &Path, id: &str, markdown: bool) -> Result<PathBuf> {
    let normalized = id.replace('\\', "/");
    if normalized.is_empty()
        || normalized.contains(':')
        || normalized.starts_with('/')
        || normalized.split('/').any(|s| {
            s.is_empty()
                || s == "."
                || s == ".."
                || s.ends_with([' ', '.'])
                || s.contains(['<', '>', '"', '|', '?', '*', '\0'])
                || s.chars().any(char::is_control)
                || IGNORED.contains(&s.to_lowercase().as_str())
                || reserved(s)
        })
    {
        return Err(Error::new("path", "Use a vault-relative path without traversal, reserved names, or hidden metadata folders."));
    }
    if markdown && !normalized.to_lowercase().ends_with(".md") {
        return Err(Error::new("path", "Note paths must end in .md"));
    }
    let mut path = root.to_path_buf();
    for part in Path::new(&normalized).components() {
        if let Component::Normal(part) = part {
            path.push(part);
        } else {
            return Err(Error::new("path", "Invalid relative path"));
        }
        match std::fs::symlink_metadata(&path) {
            Ok(meta) => {
                if meta.file_type().is_symlink() || !path.canonicalize()?.starts_with(root) {
                    return Err(Error::new(
                        "path",
                        "Symlink or junction paths are not supported",
                    ));
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(e) => return Err(e.into()),
        }
    }
    Ok(path)
}
fn reserved(s: &str) -> bool {
    let stem = s.split('.').next().unwrap_or(s).to_uppercase();
    matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && matches!(stem.as_bytes()[3], b'1'..=b'9'))
}
pub fn read(root: &Path, id: &str) -> Result<notes::Document> {
    let content = std::fs::read_to_string(contained(root, id, true)?)?;
    Ok(notes::Document {
        id: id.into(),
        revision: notes::hash(&content),
        content,
    })
}
pub fn atomic_write(
    root: &Path,
    id: &str,
    content: &str,
    expected: Option<&str>,
    markdown: bool,
) -> Result<()> {
    let path = contained(root, id, markdown)?;
    let current = match std::fs::read_to_string(&path) {
        Ok(s) => Some(notes::hash(&s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(e.into()),
    };
    if current.as_deref() != expected {
        return Err(Error::new(
            "conflict",
            "The file changed on disk. Compare the disk version before saving.",
        ));
    }
    let parent = path
        .parent()
        .ok_or_else(|| Error::new("path", "No parent directory"))?;
    std::fs::create_dir_all(parent)?;
    contained(root, id, markdown)?;
    let mut temp = tempfile::Builder::new()
        .prefix(".synapse-save-")
        .tempfile_in(parent)?;
    temp.write_all(content.as_bytes())?;
    temp.as_file().sync_all()?;
    let latest = match std::fs::read_to_string(&path) {
        Ok(s) => Some(notes::hash(&s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(e.into()),
    };
    if latest != current {
        return Err(Error::new(
            "conflict",
            "The file changed during save. Your edits remain in the editor.",
        ));
    }
    contained(root, id, markdown)?;
    if expected.is_none() {
        temp.persist_noclobber(&path)
            .map_err(|e| Error::new("conflict", e.error))?;
    } else {
        temp.persist(&path).map_err(|e| Error::new("io", e.error))?;
    }
    Ok(())
}
pub fn scan(root: &Path) -> Result<Snapshot> {
    let mut notes = Vec::new();
    let mut contents = HashMap::new();
    let mut cards = Vec::new();
    let mut warnings = Vec::new();
    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            !IGNORED
                .iter()
                .any(|n| e.file_name().to_string_lossy().eq_ignore_ascii_case(n))
        })
    {
        let entry = match entry {
            Ok(e) => e,
            Err(e) => {
                warnings.push(e.to_string());
                continue;
            }
        };
        if !entry.file_type().is_file()
            || !entry
                .path()
                .extension()
                .is_some_and(|e| e.eq_ignore_ascii_case("md"))
        {
            continue;
        }
        let id = entry
            .path()
            .strip_prefix(root)
            .map_err(|e| Error::new("path", e))?
            .to_string_lossy()
            .replace('\\', "/");
        let result: Result<Note> = (|| {
            let doc = read(root, &id)?;
            let note = notes::parse(&id, &doc.content)?;
            cards.extend(flashcards::parse(&note, &doc.content));
            contents.insert(id.clone(), doc.content);
            Ok(note)
        })();
        match result {
            Ok(note) => notes.push(note),
            Err(e) => {
                warnings.push(format!("{}: {}", id, e.message));
                // Malformed frontmatter must not make an existing note disappear from the editor.
                if let Ok(doc) = read(root, &id) {
                    notes.push(Note {
                        id: id.clone(),
                        title: id.clone(),
                        subject: Default::default(),
                        revision: doc.revision,
                        neighbors: 0,
                    });
                }
            }
        }
    }
    notes.sort_by(|a, b| a.id.cmp(&b.id));
    cards.sort_by(|a, b| a.source.cmp(&b.source));
    cards.dedup_by(|a, b| a.id == b.id);
    let mut seen = std::collections::HashSet::new();
    cards.retain(|c| seen.insert(c.id.clone()));
    let (links, edges) = links::build(&mut notes, &contents);
    let (history, review_error) = match flashcards::load(root) {
        Ok((h, _)) => (h, None),
        Err(e) => (History::default(), Some(e.message)),
    };
    Ok(Snapshot {
        root: root.to_string_lossy().into(),
        name: root
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into(),
        notes,
        links,
        edges,
        cards,
        history,
        warnings,
        review_error,
    })
}
