use crate::notes::{self, Note};
use regex::Regex;
use serde::Serialize;
use std::{
    collections::{BTreeSet, HashMap},
    sync::LazyLock,
};
pub static WIKI: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\[\[([^\[\]\n]+)\]\]").unwrap());
#[derive(Debug, Clone, Serialize)]
pub struct WikiLink {
    pub source: String,
    pub raw: String,
    pub target: Option<String>,
    pub candidates: Vec<String>,
    pub external: bool,
}
#[derive(Debug, Clone, Serialize)]
pub struct Edge {
    pub source: String,
    pub target: String,
}
pub fn target(raw: &str) -> String {
    raw.split('|')
        .next()
        .unwrap_or(raw)
        .split('#')
        .next()
        .unwrap_or(raw)
        .trim()
        .replace('\\', "/")
        .to_lowercase()
        .trim_end_matches(".md")
        .to_owned()
}
// Build the same path, basename and title lookups once per vault scan.
struct LinkIndex<'a> {
    paths: HashMap<String, Vec<&'a str>>,
    aliases: HashMap<String, BTreeSet<&'a str>>,
}
impl<'a> LinkIndex<'a> {
    fn new(notes: &'a [Note]) -> Self {
        let mut index = Self {
            paths: HashMap::new(),
            aliases: HashMap::new(),
        };
        for note in notes {
            let id = note.id.as_str();
            let lower = id.to_lowercase();
            let path = lower.trim_end_matches(".md");
            index.paths.entry(path.to_owned()).or_default().push(id);
            let basename = path.rsplit('/').next().unwrap_or(path);
            index
                .aliases
                .entry(basename.to_owned())
                .or_default()
                .insert(id);
            index
                .aliases
                .entry(note.title.to_lowercase())
                .or_default()
                .insert(id);
        }
        index
    }
    fn resolve(&self, raw: &str, source: &str) -> Vec<String> {
        let key = target(raw);
        if key.is_empty() {
            return vec![source.to_owned()];
        }
        if key.contains('/') {
            return self
                .paths
                .get(key.strip_prefix("./").unwrap_or(&key))
                .into_iter()
                .flatten()
                .map(|id| (*id).to_owned())
                .collect();
        }
        self.aliases
            .get(&key)
            .into_iter()
            .flatten()
            .map(|id| (*id).to_owned())
            .collect()
    }
}
#[cfg(test)]
pub fn resolve(raw: &str, source: &str, notes: &[Note]) -> Vec<String> {
    LinkIndex::new(notes).resolve(raw, source)
}
pub fn build(notes: &mut [Note], contents: &HashMap<String, String>) -> (Vec<WikiLink>, Vec<Edge>) {
    build_scoped(notes, contents, None)
}
pub fn build_scoped(
    notes: &mut [Note],
    contents: &HashMap<String, String>,
    org: Option<&crate::organization::Organization>,
) -> (Vec<WikiLink>, Vec<Edge>) {
    let mut links = Vec::new();
    let mut edges = BTreeSet::new();
    let index = LinkIndex::new(notes);
    for note in notes.iter() {
        let content = contents.get(&note.id).map(String::as_str).unwrap_or("");
        let content = notes::body(content).map(|(_, b)| b).unwrap_or("");
        for cap in WIKI.captures_iter(&notes::prose(content, false)) {
            let raw = cap[1].to_string();
            let external = org
                .and_then(|o| o.subject(&note.subject_id).ok())
                .is_some_and(|s| {
                    let relative = s
                        .root
                        .as_ref()
                        .and_then(|r| note.id.strip_prefix(&format!("{r}/")))
                        .unwrap_or(&note.id);
                    s.external_links
                        .get(relative)
                        .is_some_and(|ls| ls.contains(&raw))
                });
            let candidates = if external {
                Vec::new()
            } else {
                index.resolve(&raw, &note.id)
            };
            let target = if candidates.len() == 1 {
                Some(candidates[0].clone())
            } else {
                None
            };
            if let Some(ref to) = target {
                if to != &note.id {
                    let mut pair = [note.id.clone(), to.clone()];
                    pair.sort();
                    edges.insert((pair[0].clone(), pair[1].clone()));
                }
            }
            links.push(WikiLink {
                source: note.id.clone(),
                raw,
                target,
                candidates,
                external,
            });
        }
    }
    let mut degrees = HashMap::new();
    for (a, b) in &edges {
        *degrees.entry(a.as_str()).or_default() += 1;
        *degrees.entry(b.as_str()).or_default() += 1;
    }
    for note in notes {
        note.neighbors = degrees.get(note.id.as_str()).copied().unwrap_or(0);
    }
    (
        links,
        edges
            .into_iter()
            .map(|(source, target)| Edge { source, target })
            .collect(),
    )
}
