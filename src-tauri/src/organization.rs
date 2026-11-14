use crate::{
    errors::{Error, Result},
    notes::{self, Note},
    subjects::Subject,
    vault,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashSet},
    path::{Path, PathBuf},
};

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Location {
    pub neuron_id: Option<String>,
    pub subject_id: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Neuron {
    pub id: String,
    pub name: String,
    pub path: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SubjectRecord {
    pub id: String,
    pub neuron_id: String,
    pub name: String,
    pub color: String,
    pub preset: Subject,
    pub root: Option<String>,
    pub legacy: bool,
    #[serde(default)]
    pub card_keys: BTreeMap<String, String>,
    #[serde(default)]
    pub external_links: BTreeMap<String, Vec<String>>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Organization {
    pub schema_version: u32,
    pub neurons: Vec<Neuron>,
    pub subjects: Vec<SubjectRecord>,
    pub legacy_notes: BTreeMap<String, String>,
    pub fallback_subject: String,
    pub location: Location,
}
pub fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}
pub fn area(root: &Path) -> Result<PathBuf> {
    let p = root.join(".synapse");
    if !p.exists() {
        std::fs::create_dir(&p)?;
    }
    let meta = std::fs::symlink_metadata(&p)?;
    let canonical = p.canonicalize()?;
    if !meta.is_dir()
        || meta.file_type().is_symlink()
        || !canonical.starts_with(root)
        || reparse(&meta)
    {
        return Err(Error::new(
            "metadata",
            ".synapse must be a real directory inside this vault",
        ));
    }
    Ok(canonical)
}
pub fn reparse(meta: &std::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        meta.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        meta.file_type().is_symlink()
    }
}
pub fn name(value: &str) -> Result<String> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > 120 || value.chars().any(char::is_control) {
        return Err(Error::new(
            "name",
            "Use a name between 1 and 120 characters",
        ));
    }
    Ok(value.into())
}
pub fn color(value: &str) -> bool {
    value.len() == 7 && value.starts_with('#') && value[1..].bytes().all(|b| b.is_ascii_hexdigit())
}
pub fn preset_details(p: Subject) -> (&'static str, &'static str) {
    match p {
        Subject::Specialist => ("Specialist Mathematics", "#a855f7"),
        Subject::Methods => ("Mathematical Methods", "#3b82f6"),
        Subject::Physics => ("Physics", "#10b981"),
        Subject::EnglishLanguage => ("English Language", "#f59e0b"),
        Subject::General => ("General", "#64748b"),
    }
}
pub fn directory(root: &Path, parent: &str, display: &str) -> Result<String> {
    let safe: String = display
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || matches!(c, ' ' | '-' | '_') {
                c
            } else {
                '-'
            }
        })
        .collect();
    let safe = safe.trim().trim_end_matches('.');
    let stem = if safe.is_empty() { "Subject" } else { safe };
    for n in 0..10000 {
        let leaf = if n == 0 {
            stem.to_owned()
        } else {
            format!("{stem} ({n})")
        };
        let rel = if parent.is_empty() {
            leaf.clone()
        } else {
            format!("{parent}/{leaf}")
        };
        let Ok(path) = vault::contained(root, &rel, false) else {
            continue;
        };
        let exists = path
            .parent()
            .filter(|p| p.exists())
            .map(|p| -> Result<bool> {
                for e in std::fs::read_dir(p)? {
                    if e?.file_name().to_string_lossy().eq_ignore_ascii_case(&leaf) {
                        return Ok(true);
                    }
                }
                Ok(false)
            })
            .transpose()?
            .unwrap_or(false);
        if !exists {
            return Ok(rel);
        }
    }
    Err(Error::new(
        "name",
        "Could not find an available folder name",
    ))
}
pub fn validate(root: &Path, org: &Organization) -> Result<()> {
    let invalid = || {
        Error::new("metadata", "Unsupported or invalid .synapse/organization.json; the original file has been preserved")
    };
    if org.schema_version != 1 || org.neurons.is_empty() {
        return Err(invalid());
    }
    let mut ids = HashSet::new();
    for n in &org.neurons {
        if uuid::Uuid::parse_str(&n.id).is_err() || !ids.insert(&n.id) || name(&n.name).is_err() {
            return Err(invalid());
        }
        vault::contained(root, &n.path, false)?;
    }
    let mut roots = Vec::<String>::new();
    for s in &org.subjects {
        if uuid::Uuid::parse_str(&s.id).is_err()
            || !ids.insert(&s.id)
            || !org.neurons.iter().any(|n| n.id == s.neuron_id)
            || name(&s.name).is_err()
            || !color(&s.color)
        {
            return Err(invalid());
        }
        if let Some(path) = &s.root {
            vault::contained(root, path, false)?;
            let key = path.to_lowercase();
            if roots.iter().any(|r| {
                r == &key || r.starts_with(&format!("{key}/")) || key.starts_with(&format!("{r}/"))
            }) {
                return Err(invalid());
            }
            roots.push(key);
        }
        if s.card_keys.iter().any(|(a, b)| !hash_id(a) || !hash_id(b)) {
            return Err(invalid());
        }
    }
    if !org.subjects.iter().any(|s| s.id == org.fallback_subject)
        || org
            .legacy_notes
            .values()
            .any(|id| !org.subjects.iter().any(|s| &s.id == id))
    {
        return Err(invalid());
    }
    for path in org.legacy_notes.keys() {
        vault::contained(root, path, true)?;
    }
    org.check_location(&org.location)?;
    Ok(())
}
pub fn hash_id(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit())
}
pub fn load(root: &Path) -> Result<(Organization, String)> {
    let meta = area(root)?;
    let text = std::fs::read_to_string(vault::contained(&meta, "organization.json", false)?)?;
    let org: Organization = serde_json::from_str(&text).map_err(|e| {
        Error::new(
            "metadata",
            format!("Cannot read organization.json; preserved original: {e}"),
        )
    })?;
    validate(root, &org)?;
    Ok((org, notes::hash(&text)))
}
pub fn save(root: &Path, org: &Organization, revision: Option<&str>) -> Result<()> {
    validate(root, org)?;
    vault::atomic_write(
        &area(root)?,
        "organization.json",
        &serde_json::to_string_pretty(org)?,
        revision,
        false,
    )
}
pub fn ensure(root: &Path, notes: &[Note]) -> Result<Organization> {
    let meta = area(root)?;
    if meta.join("organization.json").exists() {
        return load(root).map(|(o, _)| o);
    }
    let neuron = Neuron {
        id: id(),
        name: "My Neuron".into(),
        path: directory(root, "", "My Neuron")?,
    };
    let fallback = id();
    let general = SubjectRecord {
        id: fallback.clone(),
        neuron_id: neuron.id.clone(),
        name: "General".into(),
        color: "#64748b".into(),
        preset: Subject::General,
        root: None,
        legacy: true,
        card_keys: BTreeMap::new(),
        external_links: BTreeMap::new(),
    };
    let mut org = Organization {
        schema_version: 1,
        neurons: vec![neuron],
        subjects: vec![general],
        legacy_notes: BTreeMap::new(),
        fallback_subject: fallback,
        location: Location::default(),
    };
    let mut groups = BTreeMap::<String, String>::new();
    for note in notes {
        let folder = note.id.split_once('/').map(|(p, _)| p);
        let (display, key) = if note.subject != Subject::General {
            let (n, _) = preset_details(note.subject);
            (n.to_owned(), format!("preset:{:?}", note.subject))
        } else if let Some(folder) = folder.filter(|p| crate::subjects::recognized(p).is_none()) {
            (
                folder.to_owned(),
                format!("folder:{}", folder.to_lowercase()),
            )
        } else {
            ("General".into(), "general".into())
        };
        let subject_id = if key == "general" {
            org.fallback_subject.clone()
        } else if let Some(id) = groups.get(&key) {
            id.clone()
        } else {
            let sid = id();
            org.subjects.push(SubjectRecord {
                id: sid.clone(),
                neuron_id: org.neurons[0].id.clone(),
                name: display,
                color: preset_details(note.subject).1.into(),
                preset: note.subject,
                root: None,
                legacy: true,
                card_keys: BTreeMap::new(),
                external_links: BTreeMap::new(),
            });
            groups.insert(key, sid.clone());
            sid
        };
        org.legacy_notes.insert(note.id.clone(), subject_id);
    }
    save(root, &org, None)?;
    Ok(org)
}
impl Organization {
    pub fn subject(&self, sid: &str) -> Result<&SubjectRecord> {
        self.subjects
            .iter()
            .find(|s| s.id == sid)
            .ok_or_else(|| Error::new("subject", "Subject no longer exists"))
    }
    pub fn membership(&self, note: &Note) -> &SubjectRecord {
        // Explicit managed roots win over classification/frontmatter, then frozen migration membership.
        self.subjects
            .iter()
            .find(|s| {
                s.root.as_ref().is_some_and(|r| {
                    note.id
                        .to_lowercase()
                        .starts_with(&format!("{}/", r.to_lowercase()))
                })
            })
            .or_else(|| {
                self.legacy_notes
                    .get(&note.id)
                    .and_then(|id| self.subjects.iter().find(|s| &s.id == id))
            })
            .or_else(|| {
                if note.subject != Subject::General {
                    self.subjects
                        .iter()
                        .find(|s| s.legacy && s.preset == note.subject)
                } else {
                    note.id.split_once('/').and_then(|(p, _)| {
                        // A renamed legacy subject still owns new files in its adopted folder.
                        let owners: std::collections::BTreeSet<_> = self
                            .legacy_notes
                            .iter()
                            .filter(|(path, _)| {
                                path.split_once('/')
                                    .is_some_and(|(folder, _)| folder.eq_ignore_ascii_case(p))
                            })
                            .filter_map(|(_, id)| {
                                self.subjects.iter().find(|s| {
                                    &s.id == id && s.legacy && s.preset == Subject::General
                                })
                            })
                            .map(|s| s.id.as_str())
                            .collect();
                        if owners.len() == 1 {
                            self.subjects
                                .iter()
                                .find(|s| owners.contains(s.id.as_str()))
                        } else {
                            None
                        }
                    })
                }
            })
            .unwrap_or_else(|| {
                self.subjects
                    .iter()
                    .find(|s| s.id == self.fallback_subject)
                    .expect("validated fallback")
            })
    }
    pub fn check_location(&self, loc: &Location) -> Result<()> {
        if loc
            .neuron_id
            .as_ref()
            .is_some_and(|id| !self.neurons.iter().any(|n| &n.id == id))
            || loc.subject_id.as_ref().is_some_and(|id| {
                !self
                    .subjects
                    .iter()
                    .any(|s| &s.id == id && Some(&s.neuron_id) == loc.neuron_id.as_ref())
            })
        {
            return Err(Error::new(
                "location",
                "Choose an existing Neuron or subject",
            ));
        }
        Ok(())
    }
    pub fn unique_name(&self, neuron: &str, proposed: &str, except: Option<&str>) -> String {
        let mut candidate = proposed.to_owned();
        let mut count = 2;
        while self.subjects.iter().any(|s| {
            s.neuron_id == neuron
                && Some(s.id.as_str()) != except
                && s.name.to_lowercase() == candidate.to_lowercase()
        }) {
            candidate = format!("{proposed} ({count})");
            count += 1;
        }
        candidate
    }
    pub fn new_neuron(&mut self, root: &Path, display: &str) -> Result<String> {
        let display = name(display)?;
        if self
            .neurons
            .iter()
            .any(|n| n.name.to_lowercase() == display.to_lowercase())
        {
            return Err(Error::new("name", "A Neuron already has this name"));
        }
        let path = directory(root, "", &display)?;
        std::fs::create_dir(vault::contained(root, &path, false)?)?;
        let nid = id();
        self.neurons.push(Neuron {
            id: nid.clone(),
            name: display,
            path,
        });
        Ok(nid)
    }
    pub fn new_subject(
        &mut self,
        root: &Path,
        nid: &str,
        display: &str,
        preset: Subject,
        accent: &str,
    ) -> Result<String> {
        let display = name(display)?;
        if !color(accent) {
            return Err(Error::new("color", "Choose a valid subject color"));
        }
        if self.unique_name(nid, &display, None) != display {
            return Err(Error::new(
                "name",
                "A subject already has this name in this Neuron",
            ));
        }
        let neuron = self
            .neurons
            .iter()
            .find(|n| n.id == nid)
            .ok_or_else(|| Error::new("neuron", "Choose a Neuron"))?;
        let parent = vault::contained(root, &neuron.path, false)?;
        std::fs::create_dir_all(parent)?;
        let path = directory(root, &neuron.path, &display)?;
        std::fs::create_dir(vault::contained(root, &path, false)?)?;
        let sid = id();
        self.subjects.push(SubjectRecord {
            id: sid.clone(),
            neuron_id: nid.into(),
            name: display,
            preset,
            color: accent.into(),
            root: Some(path),
            legacy: false,
            card_keys: BTreeMap::new(),
            external_links: BTreeMap::new(),
        });
        Ok(sid)
    }
    pub fn rename(&mut self, entity: &str, display: &str) -> Result<()> {
        let display = name(display)?;
        if let Some(index) = self.neurons.iter().position(|n| n.id == entity) {
            if self
                .neurons
                .iter()
                .any(|n| n.id != entity && n.name.to_lowercase() == display.to_lowercase())
            {
                return Err(Error::new("name", "A Neuron already has this name"));
            }
            self.neurons[index].name = display;
        } else {
            let s = self.subject(entity)?;
            if self.unique_name(&s.neuron_id, &display, Some(entity)) != display {
                return Err(Error::new(
                    "name",
                    "A subject already has this name in this Neuron",
                ));
            }
            self.subjects
                .iter_mut()
                .find(|s| s.id == entity)
                .unwrap()
                .name = display;
        }
        Ok(())
    }
    pub fn assign(&mut self, sid: &str, nid: &str) -> Result<()> {
        if !self.neurons.iter().any(|n| n.id == nid) {
            return Err(Error::new("neuron", "Choose a Neuron"));
        }
        let s = self.subject(sid)?;
        if self.unique_name(nid, &s.name, Some(sid)) != s.name {
            return Err(Error::new(
                "name",
                "Rename this subject before assigning it; the destination already has that name",
            ));
        }
        self.subjects
            .iter_mut()
            .find(|s| s.id == sid)
            .unwrap()
            .neuron_id = nid.into();
        if self.location.subject_id.as_deref() == Some(sid) {
            self.location.neuron_id = Some(nid.into());
        }
        Ok(())
    }
}
