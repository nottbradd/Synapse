use crate::{
    errors::{Error, Result},
    notes::{self, Note},
    subjects::Subject,
    vault,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
};
#[derive(Debug, Clone, Serialize)]
pub struct Card {
    pub id: String,
    pub content_id: String,
    pub subject_id: String,
    pub neuron_id: String,
    pub source: String,
    pub subject: Subject,
    pub question: String,
    pub answer: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Review {
    pub card_id: String,
    pub last_review: i64,
    pub due: i64,
    pub interval: f64,
    pub ease: f64,
    pub reviews: u32,
    pub lapses: u32,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct History {
    pub schema_version: u32,
    pub cards: BTreeMap<String, Review>,
    #[serde(default)]
    pub legacy_cards: BTreeMap<String, Review>,
}
impl Default for History {
    fn default() -> Self {
        Self {
            schema_version: 2,
            cards: BTreeMap::new(),
            legacy_cards: BTreeMap::new(),
        }
    }
}
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Rating {
    Again,
    Hard,
    Good,
    Easy,
}
pub fn parse(note: &Note, content: &str) -> Vec<Card> {
    let body = notes::body(content).map(|(_, b)| b).unwrap_or("");
    let safe = notes::prose(body, false);
    let clean = notes::prose(body, true);
    let lines: Vec<_> = safe.lines().collect();
    let clean_lines: Vec<_> = clean.lines().collect();
    let mut cards = Vec::new();
    let mut seen = BTreeSet::new();
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i].trim();
        let mut pair = None;
        if let Some(q) = line.strip_prefix("Q: ").filter(|_| {
            clean_lines
                .get(i)
                .is_some_and(|l| l.trim().starts_with("Q: "))
        }) {
            if i + 1 < lines.len() {
                if let Some(a) = lines[i + 1].trim().strip_prefix("A: ") {
                    let mut answer = a.to_owned();
                    i += 2;
                    while i < lines.len()
                        && !lines[i].trim().is_empty()
                        && !lines[i].trim().starts_with("Q: ")
                        && !lines[i].starts_with('#')
                    {
                        answer.push('\n');
                        answer.push_str(lines[i]);
                        i += 1;
                    }
                    pair = Some((q.to_string(), answer));
                    i = i.saturating_sub(1);
                }
            }
        } else if clean_lines
            .get(i)
            .is_some_and(|l| l.matches(" :: ").count() == 1)
            && !line.starts_with(['#', '|', '<'])
        {
            if let Some((q, a)) = line.split_once(" :: ") {
                pair = Some((q.to_string(), a.to_string()));
            }
        }
        if let Some((question, answer)) = pair {
            if !question.trim().is_empty() && !answer.trim().is_empty() {
                let norm = |s: &str| s.split_whitespace().collect::<Vec<_>>().join(" ");
                let id = notes::hash(&format!("{}\u{0}{}", norm(&question), norm(&answer)));
                if seen.insert(id.clone()) {
                    cards.push(Card {
                        content_id: id.clone(),
                        id,
                        subject_id: note.subject_id.clone(),
                        neuron_id: note.neuron_id.clone(),
                        source: note.id.clone(),
                        subject: note.subject,
                        question,
                        answer,
                    });
                }
            }
        }
        i += 1;
    }
    cards
}
pub fn schedule(id: &str, old: Option<&Review>, rating: Rating, now: i64) -> Review {
    let mut r = old.cloned().unwrap_or(Review {
        card_id: id.into(),
        last_review: now,
        due: now,
        interval: 0.0,
        ease: 2.5,
        reviews: 0,
        lapses: 0,
    });
    r.interval = match rating {
        Rating::Again => {
            r.lapses += 1;
            r.ease = (r.ease - 0.2).max(1.3);
            1.0 / 1440.0
        }
        Rating::Hard => {
            r.ease = (r.ease - 0.15).max(1.3);
            (r.interval * 1.2).max(0.5)
        }
        Rating::Good => {
            if r.interval < 1.0 {
                1.0
            } else {
                r.interval * r.ease
            }
        }
        Rating::Easy => {
            r.ease = (r.ease + 0.15).min(3.5);
            (r.interval * r.ease * 1.3).max(4.0)
        }
    }
    .min(3650.0);
    r.last_review = now;
    r.due = now + (r.interval * 86400.0).round() as i64;
    r.reviews += 1;
    r
}
pub fn load(root: &Path) -> Result<(History, Option<String>)> {
    let path = vault::contained(root, "flashcards.json", false)?;
    match std::fs::read_to_string(path) {
        Ok(text) => {
            let h = decode(&text)?;
            Ok((h, Some(notes::hash(&text))))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok((History::default(), None)),
        Err(e) => Err(e.into()),
    }
}
pub fn decode(text: &str) -> Result<History> {
    let h: History = serde_json::from_str(text)?;
    if !matches!(h.schema_version, 1 | 2)
        || (h.schema_version == 1 && !h.legacy_cards.is_empty())
        || h.cards.iter().chain(h.legacy_cards.iter()).any(|(id, r)| {
            id != &r.card_id
                || !r.interval.is_finite()
                || r.interval < 0.0
                || !(1.3..=3.5).contains(&r.ease)
                || r.due < 0
                || r.last_review < 0
        })
    {
        return Err(Error::new("metadata", "Unsupported or invalid flashcards.json. Repair or rename it to enable reviews; the original file has been preserved."));
    }
    Ok(h)
}

pub fn migrate(root: &Path, cards: &[Card]) -> Result<History> {
    let (mut h, rev) = load(root)?;
    if h.schema_version == 1 {
        let text = std::fs::read_to_string(vault::contained(root, "flashcards.json", false)?)?;
        if rev.as_deref() != Some(&notes::hash(&text)) {
            return Err(Error::new(
                "conflict",
                "Review history changed during migration; refresh to retry",
            ));
        }
        let meta = crate::organization::area(root)?;
        let backup = vault::contained(&meta, "flashcards-v1-backup.json", false)?;
        if backup.exists() {
            if std::fs::read_to_string(backup)? != text {
                return Err(Error::new("metadata", "A different v1 history backup already exists; migration paused and originals preserved"));
            }
        } else {
            vault::atomic_write(&meta, "flashcards-v1-backup.json", &text, None, false)?;
        }
        h.legacy_cards = std::mem::take(&mut h.cards);
        h.schema_version = 2;
        for card in cards {
            if let Some(old) = h.legacy_cards.get(&card.content_id) {
                let mut review = old.clone();
                review.card_id = card.id.clone();
                h.cards.insert(card.id.clone(), review);
            }
        }
        vault::atomic_write(
            root,
            "flashcards.json",
            &serde_json::to_string_pretty(&h)?,
            rev.as_deref(),
            false,
        )?;
    }
    Ok(h)
}
