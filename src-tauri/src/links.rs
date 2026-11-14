use crate::notes::{self, Note};
use regex::Regex;
use serde::Serialize;
use std::{
    collections::{BTreeSet, HashMap},
    sync::LazyLock,
};
static WIKI: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\[\[([^\[\]\n]+)\]\]").unwrap());
#[derive(Debug, Clone, Serialize)]
pub struct WikiLink {
    pub source: String,
    pub raw: String,
    pub target: Option<String>,
    pub candidates: Vec<String>,
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
pub fn resolve(raw: &str, source: &str, notes: &[Note]) -> Vec<String> {
    let key = target(raw);
    if key.is_empty() {
        return vec![source.to_owned()];
    }
    let exact: Vec<_> = notes
        .iter()
        .filter(|n| {
            n.id.to_lowercase()
                .trim_end_matches(".md")
                .eq_ignore_ascii_case(key.strip_prefix("./").unwrap_or(&key))
        })
        .map(|n| n.id.clone())
        .collect();
    if key.contains('/') {
        return exact;
    }
    notes
        .iter()
        .filter(|n| {
            n.id.rsplit('/')
                .next()
                .unwrap_or(&n.id)
                .to_lowercase()
                .trim_end_matches(".md")
                .eq_ignore_ascii_case(&key)
                || n.title.to_lowercase() == key
        })
        .map(|n| n.id.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}
pub fn build(notes: &mut [Note], contents: &HashMap<String, String>) -> (Vec<WikiLink>, Vec<Edge>) {
    let mut links = Vec::new();
    let mut edges = BTreeSet::new();
    for note in notes.iter() {
        let content = contents.get(&note.id).map(String::as_str).unwrap_or("");
        let content = notes::body(content).map(|(_, b)| b).unwrap_or("");
        for cap in WIKI.captures_iter(&notes::prose(content, false)) {
            let raw = cap[1].to_string();
            let candidates = resolve(&raw, &note.id, notes);
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
            });
        }
    }
    for note in notes {
        note.neighbors = edges
            .iter()
            .filter(|(a, b)| a == &note.id || b == &note.id)
            .count();
    }
    (
        links,
        edges
            .into_iter()
            .map(|(source, target)| Edge { source, target })
            .collect(),
    )
}
