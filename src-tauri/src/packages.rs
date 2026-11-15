use crate::{
    errors::{Error, Result},
    flashcards::{self, Review},
    links, notes,
    organization::{self, SubjectRecord},
    study, study_transfer,
    subjects::Subject,
    transactions::{self, Journal},
    vault::{self, Snapshot},
};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    fs,
    io::{Read, Write},
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        LazyLock,
    },
};

pub const MAX_ENTRIES: usize = 10_000;
pub const MAX_FILE: u64 = 32 * 1024 * 1024;
pub const MAX_TOTAL: u64 = 256 * 1024 * 1024;
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PackageSubject {
    pub id: String,
    pub name: String,
    pub color: String,
    pub preset: Subject,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LinkMap {
    pub raw: String,
    pub target: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    pub schema_version: u32,
    pub subject: PackageSubject,
    pub files: BTreeMap<String, String>,
    pub notes: Vec<String>,
    pub links: BTreeMap<String, Vec<LinkMap>>,
    pub card_keys: BTreeMap<String, String>,
    pub history: Option<BTreeMap<String, Review>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub study: Option<study_transfer::Portable>,
}
pub struct Plan {
    pub token: String,
    pub manifest: Manifest,
    pub files: BTreeMap<String, Vec<u8>>,
}
#[derive(Debug, Clone, Serialize)]
pub struct Preview {
    pub token: String,
    pub name: String,
    pub color: String,
    pub notes: usize,
    pub attachments: usize,
    pub bytes: u64,
    pub external_references: Vec<String>,
    pub external_count: usize,
    pub has_history: bool,
    pub quizzes: usize,
    pub reminders: usize,
    pub quiz_attempts: usize,
    pub flashcard_batches: usize,
}
impl Plan {
    pub fn preview(&self) -> Preview {
        let external: Vec<_> = self
            .manifest
            .links
            .iter()
            .flat_map(|(source, ls)| {
                ls.iter()
                    .filter(|l| l.target.is_none())
                    .map(move |l| format!("{source}: [[{}]]", l.raw))
            })
            .collect();
        Preview {
            quizzes: self.manifest.study.as_ref().map_or(0, |s| s.quizzes.len()),
            reminders: self
                .manifest
                .study
                .as_ref()
                .map_or(0, |s| s.reminders.len()),
            quiz_attempts: self.manifest.study.as_ref().map_or(0, |s| s.attempts.len()),
            flashcard_batches: self
                .manifest
                .study
                .as_ref()
                .map_or(0, |s| s.flashcard_batches.len()),
            token: self.token.clone(),
            name: self.manifest.subject.name.clone(),
            color: self.manifest.subject.color.clone(),
            notes: self.manifest.notes.len(),
            attachments: self.files.len() - self.manifest.notes.len(),
            bytes: self.files.values().map(|b| b.len() as u64).sum(),
            external_count: external.len(),
            external_references: external.into_iter().take(20).collect(),
            has_history: self
                .manifest
                .history
                .as_ref()
                .is_some_and(|h| !h.is_empty()),
        }
    }
}
fn canceled(cancel: &AtomicBool) -> Result<()> {
    if cancel.load(Ordering::Relaxed) {
        Err(Error::new(
            "cancelled",
            "Import canceled; existing files are unchanged",
        ))
    } else {
        Ok(())
    }
}
fn bounded(path: &Path) -> Result<Vec<u8>> {
    if fs::metadata(path)?.len() > MAX_FILE {
        return Err(Error::new("limit", "A file exceeds the 32 MiB limit"));
    }
    let mut bytes = Vec::new();
    fs::File::open(path)?
        .take(MAX_FILE + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_FILE {
        return Err(Error::new("limit", "A file exceeds the 32 MiB limit"));
    }
    Ok(bytes)
}
fn check_size(files: &BTreeMap<String, Vec<u8>>) -> Result<()> {
    if files.len() > MAX_ENTRIES
        || files.values().any(|b| b.len() as u64 > MAX_FILE)
        || files.values().map(|b| b.len() as u64).sum::<u64>() > MAX_TOTAL
    {
        return Err(Error::new(
            "limit",
            "Subject exceeds 10,000 files, 32 MiB per file or 256 MiB total",
        ));
    }
    Ok(())
}
fn attachment(path: &str) -> bool {
    matches!(
        path.rsplit('.')
            .next()
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str(),
        "png"
            | "jpg"
            | "jpeg"
            | "gif"
            | "webp"
            | "svg"
            | "avif"
            | "bmp"
            | "ico"
            | "pdf"
            | "mp3"
            | "wav"
            | "ogg"
            | "m4a"
            | "mp4"
            | "webm"
            | "mov"
    )
}
// Reject case aliases for every component, not only full filenames (a/x vs A/y).
fn paths(root: &Path, names: impl Iterator<Item = String>) -> Result<()> {
    let mut all = BTreeMap::<String, String>::new();
    let mut files = BTreeSet::new();
    for path in names {
        if path.contains('\\') {
            return Err(Error::new(
                "archive",
                "Package paths must use forward slashes",
            ));
        }
        vault::contained(root, &path, false)?;
        let mut prefix = String::new();
        for part in path.split('/') {
            if !prefix.is_empty() {
                prefix.push('/');
            }
            prefix.push_str(part);
            let key = prefix.to_lowercase();
            if all.get(&key).is_some_and(|p| p != &prefix)
                || (prefix != path && files.contains(&key))
            {
                return Err(Error::new(
                    "archive",
                    "Conflicting or case-insensitive archive paths",
                ));
            }
            all.insert(key, prefix.clone());
        }
        let key = path.to_lowercase();
        if !files.insert(key.clone()) || all.keys().any(|p| p.starts_with(&format!("{key}/"))) {
            return Err(Error::new(
                "archive",
                "Duplicate file or file/directory collision",
            ));
        }
    }
    Ok(())
}
fn validate(root: &Path, plan: &Plan) -> Result<()> {
    let m = &plan.manifest;
    if !(1..=2).contains(&m.schema_version)
        || (m.schema_version == 1 && m.study.is_some())
        || uuid::Uuid::parse_str(&m.subject.id).is_err()
        || !organization::color(&m.subject.color)
    {
        return Err(Error::new(
            "manifest",
            "Unsupported or invalid subject manifest",
        ));
    }
    organization::name(&m.subject.name)?;
    check_size(&plan.files)?;
    paths(root, plan.files.keys().cloned())?;
    if m.files.len() != plan.files.len()
        || m.files.iter().any(|(p, h)| {
            plan.files
                .get(p)
                .is_none_or(|b| transactions::digest(b) != *h)
        })
    {
        return Err(Error::new(
            "manifest",
            "Package contents do not match the manifest",
        ));
    }
    let note_set: BTreeSet<_> = m.notes.iter().cloned().collect();
    if let Some(s) = &m.study {
        s.validate(&m.subject.id, &note_set)?;
    }
    if note_set.len() != m.notes.len()
        || m.notes
            .iter()
            .any(|p| !p.to_lowercase().ends_with(".md") || !plan.files.contains_key(p))
        || plan.files.keys().any(|p| {
            if p.to_lowercase().ends_with(".md") {
                !note_set.contains(p)
            } else {
                !attachment(p)
            }
        })
    {
        return Err(Error::new(
            "manifest",
            "Package contains unlisted notes or unsupported attachments",
        ));
    }
    if m.card_keys
        .iter()
        .any(|(a, b)| !organization::hash_id(a) || !organization::hash_id(b))
    {
        return Err(Error::new("manifest", "Invalid card identity mapping"));
    }
    for (source, mappings) in &m.links {
        if !note_set.contains(source) {
            return Err(Error::new(
                "manifest",
                "Unknown source note in link mapping",
            ));
        }
        let mut raw = BTreeSet::new();
        for l in mappings {
            if !raw.insert(&l.raw) || l.target.as_ref().is_some_and(|p| !note_set.contains(p)) {
                return Err(Error::new("manifest", "Invalid or duplicate link mapping"));
            }
        }
    }
    let mut card_ids = BTreeSet::new();
    for path in &m.notes {
        let text = std::str::from_utf8(&plan.files[path]).map_err(|e| Error::new("encoding", e))?;
        let note = notes::parse(path, text)?;
        for card in flashcards::parse(&note, text) {
            card_ids.insert(m.card_keys.get(&card.id).cloned().unwrap_or(card.id));
        }
        let safe = notes::prose(notes::body(text)?.1, false);
        for cap in links::WIKI.captures_iter(&safe) {
            if !m
                .links
                .get(path)
                .is_some_and(|ls| ls.iter().any(|l| l.raw == cap[1]))
            {
                return Err(Error::new("manifest", "Missing WikiLink identity mapping"));
            }
        }
        // Every local media URL must stay inside the package and refer to a listed file.
        for (_, url) in media_refs(text)? {
            if let Some(local) = local_path(path, &url)? {
                if !plan.files.contains_key(&local) {
                    return Err(Error::new(
                        "attachment",
                        format!("Missing local reference in {path}: {url}"),
                    ));
                }
            }
        }
    }
    if let Some(history) = &m.history {
        for (id, r) in history {
            if !card_ids.contains(id)
                || &r.card_id != id
                || !r.interval.is_finite()
                || r.interval < 0.0
                || !(1.3..=3.5).contains(&r.ease)
                || r.last_review < 0
                || r.due < 0
            {
                return Err(Error::new("manifest", "Invalid review history in package"));
            }
        }
    }
    Ok(())
}

// Locate actual Markdown destinations, ignoring fenced/inline code and frontmatter.
// Inline URLs, angle-bracket URLs and reference definitions are supported.
static MEDIA: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"!?\[[^\]\n]*\]\(\s*(?:<([^>\n]+)>|([^\s)]+))|(?m:^\s{0,3}\[[^\]\n]+\]:\s*(?:<([^>\n]+)>|(\S+)))"#).unwrap()
});
fn media_refs(text: &str) -> Result<Vec<(std::ops::Range<usize>, String)>> {
    let (_, body) = notes::body(text)?;
    let start = text.len() - body.len();
    let safe = notes::prose(body, false);
    Ok(MEDIA
        .captures_iter(&safe)
        .filter_map(|c| (1..=4).find_map(|i| c.get(i)))
        .map(|m| (start + m.start()..start + m.end(), m.as_str().to_owned()))
        .collect())
}
fn local_path(source: &str, url: &str) -> Result<Option<String>> {
    if url.starts_with('#')
        || url.starts_with("https://")
        || url.starts_with("http://")
        || url.starts_with("mailto:")
    {
        return Ok(None);
    }
    let raw = url.split(['#', '?']).next().unwrap_or(url);
    // Decode percent escapes before path validation, including encoded traversal/drive prefixes.
    let mut decoded = Vec::new();
    let bytes = raw.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if i + 2 >= bytes.len() {
                return Err(Error::new("attachment", "Invalid URL escape"));
            }
            let v = u8::from_str_radix(&raw[i + 1..i + 3], 16)
                .map_err(|_| Error::new("attachment", "Invalid URL escape"))?;
            decoded.push(v);
            i += 3;
        } else {
            decoded.push(bytes[i]);
            i += 1;
        }
    }
    let raw = String::from_utf8(decoded)
        .map_err(|e| Error::new("attachment", e))?
        .replace('\\', "/");
    if raw.starts_with('/') || raw.contains(':') || raw.is_empty() {
        return Err(Error::new(
            "attachment",
            "Absolute or unsupported local references cannot be packaged",
        ));
    }
    let mut parts: Vec<_> = source.split('/').collect();
    parts.pop();
    for p in raw.split('/') {
        match p {
            "." => (),
            ".." => {
                if parts.pop().is_none() {
                    return Err(Error::new(
                        "attachment",
                        "A local reference escapes the source folder",
                    ));
                }
            }
            "" => return Err(Error::new("attachment", "Invalid local reference")),
            _ => parts.push(p),
        }
    }
    Ok(Some(parts.join("/")))
}
fn replace(text: &str, mut edits: Vec<(std::ops::Range<usize>, String)>) -> String {
    edits.sort_by_key(|(range, _)| range.start);
    let mut result = text.to_owned();
    for (range, value) in edits.into_iter().rev() {
        result.replace_range(range, &value);
    }
    result
}
fn relative(from: &str, to: &str) -> String {
    let mut a: Vec<_> = from.split('/').collect();
    a.pop();
    let b: Vec<_> = to.split('/').collect();
    let shared = a.iter().zip(&b).take_while(|(a, b)| a == b).count();
    std::iter::repeat_n("..", a.len() - shared)
        .chain(b[shared..].iter().copied())
        .collect::<Vec<_>>()
        .join("/")
}
fn mapped_cards(
    m: &mut Manifest,
    before: &str,
    after: &str,
    source: &str,
    original: &BTreeMap<String, String>,
) -> Result<()> {
    let note = notes::parse(source, before)?;
    let a = flashcards::parse(&note, before);
    let b = flashcards::parse(&note, after);
    if a.len() != b.len() {
        return Err(Error::new("card", "Link rewriting changed card structure"));
    }
    for (a, b) in a.iter().zip(b) {
        let canonical = original.get(&a.id).cloned().unwrap_or(a.id.clone());
        m.card_keys.insert(b.id, canonical);
    }
    Ok(())
}
pub fn prepare_export(
    root: &Path,
    snapshot: &Snapshot,
    sid: &str,
    include_history: bool,
    cancel: &AtomicBool,
) -> Result<Plan> {
    let subject = snapshot.organization.subject(sid)?;
    if include_history && snapshot.review_error.is_some() {
        return Err(Error::new(
            "metadata",
            "Repair review history before including it in an export",
        ));
    }
    let selected: Vec<_> = snapshot
        .notes
        .iter()
        .filter(|n| n.subject_id == sid)
        .collect();
    let mapping: BTreeMap<_, _> = selected
        .iter()
        .map(|n| {
            let rel = subject
                .root
                .as_ref()
                .and_then(|r| n.id.strip_prefix(&format!("{r}/")))
                .unwrap_or(&n.id)
                .to_owned();
            (n.id.clone(), rel)
        })
        .collect();
    let mut manifest = Manifest {
        schema_version: 1,
        subject: PackageSubject {
            id: sid.into(),
            name: subject.name.clone(),
            color: subject.color.clone(),
            preset: subject.preset,
        },
        files: BTreeMap::new(),
        notes: mapping.values().cloned().collect(),
        links: BTreeMap::new(),
        card_keys: BTreeMap::new(),
        history: include_history.then(BTreeMap::new),
        study: study_transfer::export(&study::load(root)?.data, sid, &mapping, include_history)?,
    };
    if manifest.study.is_some() {
        manifest.schema_version = 2;
    }
    for link in snapshot
        .links
        .iter()
        .filter(|l| mapping.contains_key(&l.source))
    {
        let entry = manifest
            .links
            .entry(mapping[&link.source].clone())
            .or_default();
        if !entry.iter().any(|l| l.raw == link.raw) {
            entry.push(LinkMap {
                raw: link.raw.clone(),
                target: link.target.as_ref().and_then(|t| mapping.get(t)).cloned(),
            });
        }
    }
    let mut files = BTreeMap::new();
    for note in selected {
        canceled(cancel)?;
        let doc = vault::read(root, &note.id)?;
        if doc.revision != note.revision {
            return Err(Error::new(
                "conflict",
                "A note changed during export; refresh and try again",
            ));
        }
        let rel = &mapping[&note.id];
        let mut edits = Vec::new();
        for (range, url) in media_refs(&doc.content)? {
            if let Some(local) = local_path(&note.id, &url)? {
                if let Some(target) = mapping.get(&local) {
                    let suffix = url.find(['#', '?']).map(|i| &url[i..]).unwrap_or("");
                    edits.push((
                        range,
                        format!("{}{suffix}", relative(rel, target).replace(' ', "%20")),
                    ));
                } else {
                    if !attachment(&local) {
                        return Err(Error::new(
                            "attachment",
                            format!("Cannot package unrelated or unsupported local file: {local}"),
                        ));
                    }
                    let data = bounded(&vault::contained(root, &local, false)?)?;
                    let target = format!(
                        "attachments/{}.{}",
                        &transactions::digest(&data)[..24],
                        local.rsplit('.').next().unwrap().to_lowercase()
                    );
                    edits.push((range, relative(rel, &target)));
                    files.insert(target, data);
                    check_size(&files)?;
                }
            }
        }
        let after = replace(&doc.content, edits);
        mapped_cards(&mut manifest, &doc.content, &after, rel, &subject.card_keys)?;
        files.insert(rel.clone(), after.into_bytes());
        check_size(&files)?;
    }
    if let Some(h) = &mut manifest.history {
        for card in snapshot.cards.iter().filter(|c| c.subject_id == sid) {
            if let Some(review) = snapshot.history.cards.get(&card.id) {
                let mut r = review.clone();
                r.card_id = card.content_id.clone();
                h.insert(card.content_id.clone(), r);
            }
        }
    }
    manifest.files = files
        .iter()
        .map(|(p, b)| (p.clone(), transactions::digest(b)))
        .collect();
    let plan = Plan {
        token: organization::id(),
        manifest,
        files,
    };
    validate(root, &plan)?;
    Ok(plan)
}
pub fn write_export(plan: &Plan, output: &Path) -> Result<()> {
    if output
        .extension()
        .is_none_or(|e| !e.eq_ignore_ascii_case("synapse-subject"))
    {
        return Err(Error::new("path", "Use the .synapse-subject extension"));
    }
    let parent = output
        .parent()
        .ok_or_else(|| Error::new("path", "Choose a destination folder"))?
        .canonicalize()?;
    let filename = output
        .file_name()
        .ok_or_else(|| Error::new("path", "Choose a filename"))?
        .to_string_lossy();
    let output = vault::contained(&parent, &filename, false)?;
    if output.exists() {
        return Err(Error::new(
            "conflict",
            "This export already exists; choose a different filename",
        ));
    }
    let mut temp = tempfile::NamedTempFile::new_in(&parent)?;
    {
        let mut zip = zip::ZipWriter::new(temp.as_file_mut());
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .unix_permissions(0o644);
        zip.start_file("manifest.json", options)
            .map_err(|e| Error::new("archive", e))?;
        zip.write_all(&serde_json::to_vec_pretty(&plan.manifest)?)?;
        for (p, b) in &plan.files {
            zip.start_file(format!("content/{p}"), options)
                .map_err(|e| Error::new("archive", e))?;
            zip.write_all(b)?;
        }
        zip.finish().map_err(|e| Error::new("archive", e))?;
    }
    temp.as_file().sync_all()?;
    temp.persist_noclobber(output)
        .map_err(|e| Error::new("conflict", e.error))?;
    Ok(())
}
pub fn inspect(root: &Path, input: &Path, cancel: &AtomicBool) -> Result<Plan> {
    canceled(cancel)?;
    let input_meta = fs::symlink_metadata(input)?;
    if organization::reparse(&input_meta) {
        return Err(Error::new(
            "path",
            "Choose a real file or folder, not a symlink or junction",
        ));
    }
    let input = input.canonicalize()?;
    let plan = if input.is_dir() {
        folder(&input, cancel)?
    } else {
        archive(root, &input, cancel)?
    };
    canceled(cancel)?;
    validate(root, &plan)?;
    Ok(plan)
}
fn archive(root: &Path, path: &Path, cancel: &AtomicBool) -> Result<Plan> {
    let mut zip = zip::ZipArchive::new(fs::File::open(path)?).map_err(|_| {
        Error::new(
            "archive",
            "This file is not a readable subject package. Choose a .synapse-subject file exported by Synapse.",
        )
    })?;
    if zip.len() > MAX_ENTRIES + 1 {
        return Err(Error::new("limit", "Too many archive entries"));
    }
    let mut raw = BTreeMap::new();
    let mut total = 0u64;
    let mut names = Vec::new();
    for i in 0..zip.len() {
        canceled(cancel)?;
        let mut entry = zip.by_index(i).map_err(|e| Error::new("archive", e))?;
        let name = entry
            .name()
            .map_err(|e| Error::new("archive", e))?
            .into_owned();
        if entry.is_dir() {
            return Err(Error::new(
                "archive",
                "Directory entries are not part of the subject package format",
            ));
        }
        if entry
            .unix_mode()
            .is_some_and(|m| m & 0o170000 != 0 && m & 0o170000 != 0o100000)
        {
            return Err(Error::new(
                "archive",
                "Symlinks and special archive entries are not supported",
            ));
        }
        names.push(name.clone());
        if entry.size() > MAX_FILE {
            return Err(Error::new("limit", "Archive entry exceeds 32 MiB"));
        }
        let mut data = Vec::new();
        entry.by_ref().take(MAX_FILE + 1).read_to_end(&mut data)?;
        total = total.saturating_add(data.len() as u64);
        if data.len() as u64 > MAX_FILE || total > MAX_TOTAL {
            return Err(Error::new(
                "limit",
                "Archive exceeds decompressed size limit",
            ));
        }
        if raw.insert(name, data).is_some() {
            return Err(Error::new("archive", "Duplicate archive entry"));
        }
    }
    paths(root, names.into_iter())?;
    let manifest: Manifest = serde_json::from_slice(
        &raw.remove("manifest.json")
            .ok_or_else(|| Error::new("manifest", "Missing manifest.json"))?,
    )
    .map_err(|e| Error::new("manifest", e))?;
    let mut files = BTreeMap::new();
    for (p, b) in raw {
        let rel = p
            .strip_prefix("content/")
            .ok_or_else(|| Error::new("archive", "Unexpected archive entry"))?;
        files.insert(rel.into(), b);
    }
    Ok(Plan {
        token: organization::id(),
        manifest,
        files,
    })
}
fn folder(source: &Path, cancel: &AtomicBool) -> Result<Plan> {
    let mut all_notes = Vec::new();
    let mut contents = HashMap::new();
    let mut files = BTreeMap::new();
    let mut visited = 0;
    for entry in walkdir::WalkDir::new(source)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            !vault::IGNORED
                .iter()
                .any(|n| e.file_name().to_string_lossy().eq_ignore_ascii_case(n))
        })
    {
        canceled(cancel)?;
        let entry = entry.map_err(|e| Error::new("import", e))?;
        visited += 1;
        if visited > MAX_ENTRIES * 2 {
            return Err(Error::new("limit", "Source folder has too many entries"));
        }
        if entry.path() == source {
            continue;
        }
        let rel = entry
            .path()
            .strip_prefix(source)
            .map_err(|e| Error::new("path", e))?
            .to_string_lossy()
            .replace('\\', "/");
        let path = vault::contained(source, &rel, false)?;
        if entry.file_type().is_file() && rel.to_lowercase().ends_with(".md") {
            let bytes = bounded(&path)?;
            let text = String::from_utf8(bytes.clone()).map_err(|e| Error::new("encoding", e))?;
            let note = notes::parse(&rel, &text)?;
            all_notes.push(note);
            contents.insert(rel.clone(), text);
            files.insert(rel, bytes);
            check_size(&files)?;
        }
    }
    let (ls, _) = links::build(&mut all_notes, &contents);
    let mut mappings = BTreeMap::<String, Vec<LinkMap>>::new();
    for l in ls {
        let dest = mappings.entry(l.source).or_default();
        if !dest.iter().any(|m| m.raw == l.raw) {
            dest.push(LinkMap {
                raw: l.raw,
                target: l.target,
            });
        }
    }
    for (p, text) in &contents {
        for (_, url) in media_refs(text)? {
            canceled(cancel)?;
            if let Some(local) = local_path(p, &url)? {
                if !files.contains_key(&local) {
                    if !attachment(&local) {
                        return Err(Error::new(
                            "attachment",
                            format!("Unsupported local reference in {p}: {url}"),
                        ));
                    }
                    files.insert(
                        local.clone(),
                        bounded(&vault::contained(source, &local, false)?)?,
                    );
                    check_size(&files)?;
                }
            }
        }
    }
    let name = source
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    let preset = crate::subjects::recognized(&name).unwrap_or_default();
    let manifest = Manifest {
        schema_version: 1,
        subject: PackageSubject {
            id: organization::id(),
            name,
            color: organization::preset_details(preset).1.into(),
            preset,
        },
        files: files
            .iter()
            .map(|(p, b)| (p.clone(), transactions::digest(b)))
            .collect(),
        notes: contents.keys().cloned().collect(),
        links: mappings,
        card_keys: BTreeMap::new(),
        history: None,
        study: None,
    };
    Ok(Plan {
        token: organization::id(),
        manifest,
        files,
    })
}
pub fn import(
    root: &Path,
    plan: &Plan,
    nid: &str,
    requested_name: &str,
    include_history: bool,
    cancel: &AtomicBool,
) -> Result<String> {
    canceled(cancel)?;
    validate(root, plan)?;
    let (mut org, org_rev) = organization::load(root)?;
    let original_org = fs::read_to_string(vault::contained(
        &organization::area(root)?,
        "organization.json",
        false,
    )?)?;
    if notes::hash(&original_org) != org_rev {
        return Err(Error::new(
            "conflict",
            "Organization changed; refresh before importing",
        ));
    }
    let name = organization::name(requested_name)?;
    if org.unique_name(nid, &name, None) != name {
        return Err(Error::new(
            "name",
            "Subject name is now in use; choose another name",
        ));
    }
    let neuron = org
        .neurons
        .iter()
        .find(|n| n.id == nid)
        .ok_or_else(|| Error::new("neuron", "Choose a destination Neuron"))?;
    let dest = organization::directory(root, &neuron.path, &name)?;
    let sid = organization::id();
    let mut subject = SubjectRecord {
        id: sid.clone(),
        neuron_id: nid.into(),
        name,
        color: plan.manifest.subject.color.clone(),
        preset: plan.manifest.subject.preset,
        root: Some(dest.clone()),
        legacy: false,
        card_keys: BTreeMap::new(),
        external_links: BTreeMap::new(),
    };
    let mut files = plan.files.clone();
    let mut identity = plan.manifest.clone();
    identity.card_keys.clear();
    for path in &plan.manifest.notes {
        canceled(cancel)?;
        let before = std::str::from_utf8(&files[path]).map_err(|e| Error::new("encoding", e))?;
        let (_, body) = notes::body(before)?;
        let offset = before.len() - body.len();
        let safe = notes::prose(body, false);
        let mappings = plan.manifest.links.get(path);
        let mut edits = Vec::new();
        for cap in links::WIKI.captures_iter(&safe) {
            let raw = &cap[1];
            if let Some(target) = mappings
                .and_then(|ls| ls.iter().find(|l| l.raw == raw))
                .and_then(|l| l.target.as_ref())
            {
                let suffix = raw.find(['#', '|']).map(|i| &raw[i..]).unwrap_or("");
                let part = cap.get(1).unwrap();
                edits.push((
                    offset + part.start()..offset + part.end(),
                    format!(
                        "{dest}/{}{suffix}",
                        target.trim_end_matches(".md").trim_end_matches(".MD")
                    ),
                ));
            } else {
                let ls = subject.external_links.entry(path.clone()).or_default();
                if !ls.iter().any(|l| l == raw) {
                    ls.push(raw.into());
                }
            }
        }
        let after = replace(before, edits);
        mapped_cards(
            &mut identity,
            before,
            &after,
            path,
            &plan.manifest.card_keys,
        )?;
        files.insert(path.clone(), after.into_bytes());
    }
    subject.card_keys = identity.card_keys;
    let (mut history, history_rev) = flashcards::load(root)?;
    let original_history =
        match fs::read_to_string(vault::contained(root, "flashcards.json", false)?) {
            Ok(s) => Some(s),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(e) => return Err(e.into()),
        };
    if original_history.as_ref().map(|s| notes::hash(s)) != history_rev {
        return Err(Error::new(
            "conflict",
            "History changed; refresh before importing",
        ));
    }
    if history.schema_version != 2 {
        return Err(Error::new(
            "metadata",
            "Refresh the vault to migrate review history first",
        ));
    }
    if include_history {
        if let Some(included) = &plan.manifest.history {
            for (key, r) in included {
                let mut review = r.clone();
                review.card_id = format!("{sid}:{key}");
                history.cards.insert(review.card_id.clone(), review);
            }
        }
    }
    org.subjects.push(subject);
    let (study_before, study_after) = if let Some(portable) = &plan.manifest.study {
        let mut view = study::load(root)?;
        let before = match fs::read_to_string(vault::contained(
            &organization::area(root)?,
            "study.json",
            false,
        )?) {
            Ok(raw) => Some(raw),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(e) => return Err(e.into()),
        };
        if before.as_ref().map(|s| notes::hash(s)) != view.revision {
            return Err(Error::new(
                "conflict",
                "Study content changed; refresh before importing",
            ));
        }
        study_transfer::import(
            &mut view.data,
            portable,
            &sid,
            &dest,
            &plan.manifest.notes,
            include_history,
        )?;
        (before, Some(serde_json::to_string_pretty(&view.data)?))
    } else {
        (None, None)
    };
    org.location = organization::Location {
        neuron_id: Some(nid.into()),
        subject_id: Some(sid.clone()),
    };
    organization::validate(root, &org)?;
    let meta = organization::area(root)?;
    let stage = tempfile::Builder::new()
        .prefix("import-")
        .tempdir_in(&meta)?;
    let canonical = stage.path().canonicalize()?;
    for (path, bytes) in &files {
        canceled(cancel)?;
        let path = vault::contained(&canonical, path, false)?;
        fs::create_dir_all(path.parent().unwrap())?;
        let mut file = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(path)?;
        file.write_all(bytes)?;
        file.sync_all()?;
    }
    canceled(cancel)?;
    let journal = Journal {
        schema_version: 1,
        stage: stage.path().file_name().unwrap().to_string_lossy().into(),
        destination: dest,
        files: files
            .iter()
            .map(|(p, b)| (p.clone(), transactions::digest(b)))
            .collect(),
        organization_before: original_org,
        organization_after: serde_json::to_string_pretty(&org)?,
        history_before: original_history,
        history_after: serde_json::to_string_pretty(&history)?,
        study_before,
        study_after,
    };
    // Once durable publication starts cancellation no longer applies. Retain staging on
    // failure so next refresh can finish the same operation without losing any originals.
    let retained = stage.keep();
    match transactions::begin(root, &journal) {
        Ok(()) => Ok(sid),
        Err(e) => {
            let _ = retained;
            Err(Error::new("import", format!("Import publication paused: {}. Refresh to recover; existing files have been preserved.", e.message)))
        }
    }
}
