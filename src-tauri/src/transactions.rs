// Imports publish a whole directory and two metadata files. A durable journal makes
// interrupted publication recoverable before any snapshot is exposed to the UI.
use crate::{
    errors::{Error, Result},
    notes, organization, vault,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, path::Path};

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Journal {
    pub schema_version: u32,
    pub stage: String,
    pub destination: String,
    pub files: BTreeMap<String, String>,
    pub organization_before: String,
    pub organization_after: String,
    pub history_before: Option<String>,
    pub history_after: String,
}
pub fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn current(root: &Path, file: &str) -> Result<Option<String>> {
    match std::fs::read_to_string(vault::contained(root, file, false)?) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}
fn acceptable(value: &Option<String>, before: Option<&str>, after: &str) -> bool {
    value.as_deref() == before || value.as_deref() == Some(after)
}
pub fn begin(root: &Path, journal: &Journal) -> Result<()> {
    vault::atomic_write(
        &organization::area(root)?,
        "pending-import.json",
        &serde_json::to_string_pretty(journal)?,
        None,
        false,
    )?;
    recover(root)
}
pub fn recover(root: &Path) -> Result<()> {
    let meta = organization::area(root)?;
    let Some(text) = current(&meta, "pending-import.json")? else {
        return Ok(());
    };
    let journal: Journal = serde_json::from_str(&text).map_err(|e| {
        Error::new(
            "recovery",
            format!("Import journal is invalid; no files were replaced: {e}"),
        )
    })?;
    if journal.schema_version != 1
        || !journal.stage.starts_with("import-")
        || journal.stage.contains(['/', '\\'])
        || journal.files.len() > crate::packages::MAX_ENTRIES
    {
        return Err(Error::new(
            "recovery",
            "Unsupported import journal; original files preserved",
        ));
    }
    let org: organization::Organization = serde_json::from_str(&journal.organization_after)?;
    organization::validate(root, &org)?;
    if crate::flashcards::decode(&journal.history_after)?.schema_version != 2 {
        return Err(Error::new(
            "recovery",
            "Import journal contains unsupported history",
        ));
    }
    let stage = vault::contained(&meta, &journal.stage, false)?;
    let dest = vault::contained(root, &journal.destination, false)?;
    let original = current(&meta, "organization.json")?;
    let history = current(root, "flashcards.json")?;
    if !acceptable(
        &original,
        Some(&journal.organization_before),
        &journal.organization_after,
    ) || !acceptable(
        &history,
        journal.history_before.as_deref(),
        &journal.history_after,
    ) {
        return Err(Error::new("recovery", "Metadata changed outside Synapse during an import. Recovery paused; keep pending-import.json and the original files for reconciliation."));
    }
    let source = if stage.exists() {
        if dest.exists() {
            return Err(Error::new(
                "recovery",
                "Import destination now exists; original files preserved",
            ));
        }
        &stage
    } else {
        &dest
    };
    let source = source.canonicalize()?;
    let mut actual = BTreeMap::new();
    for entry in walkdir::WalkDir::new(&source).follow_links(false) {
        let entry = entry.map_err(|e| Error::new("recovery", e))?;
        if entry.path() == source {
            continue;
        }
        let rel = entry
            .path()
            .strip_prefix(&source)
            .map_err(|e| Error::new("path", e))?
            .to_string_lossy()
            .replace('\\', "/");
        let path = vault::contained(&source, &rel, false)?;
        if entry.file_type().is_file() {
            if std::fs::metadata(&path)?.len() > crate::packages::MAX_FILE {
                return Err(Error::new("recovery", "Imported file exceeds size limit"));
            }
            actual.insert(rel, digest(&std::fs::read(path)?));
        }
    }
    if actual != journal.files {
        return Err(Error::new(
            "recovery",
            "Staged import changed; original metadata preserved",
        ));
    }
    if stage.exists() {
        let parent = dest
            .parent()
            .ok_or_else(|| Error::new("path", "Missing destination parent"))?;
        std::fs::create_dir_all(parent)?;
        vault::contained(root, &journal.destination, false)?;
        std::fs::rename(&stage, &dest)?;
    }
    if history.as_deref() != Some(&journal.history_after) {
        vault::atomic_write(
            root,
            "flashcards.json",
            &journal.history_after,
            history.as_ref().map(|s| notes::hash(s)).as_deref(),
            false,
        )?;
    }
    if original.as_deref() != Some(&journal.organization_after) {
        vault::atomic_write(
            &meta,
            "organization.json",
            &journal.organization_after,
            original.as_ref().map(|s| notes::hash(s)).as_deref(),
            false,
        )?;
    }
    // Recheck the journal too: never remove a concurrently edited recovery record.
    if current(&meta, "pending-import.json")?.as_deref() != Some(&text) {
        return Err(Error::new(
            "recovery",
            "Import journal changed during recovery",
        ));
    }
    std::fs::remove_file(vault::contained(&meta, "pending-import.json", false)?)?;
    Ok(())
}
