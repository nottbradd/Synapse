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
#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Rating {
    Again,
    Hard,
    Good,
    Easy,
}
#[derive(Debug, Clone, Serialize)]
pub struct RecallBlock {
    pub content_id: String,
    pub question: String,
    pub answer: String,
    // UTF-16 offsets into Presentation.body, matching Markdown's JS positions.
    pub start: usize,
    pub end: usize,
}
#[derive(Debug, Serialize)]
pub struct Presentation {
    pub body: String,
    pub recalls: Vec<RecallBlock>,
}
pub fn presentation(content: &str) -> Result<Presentation> {
    let (_, body) = notes::body(content)?;
    Ok(Presentation {
        body: body.into(),
        recalls: extract(body),
    })
}
fn extract(body: &str) -> Vec<RecallBlock> {
    let safe = notes::prose(body, false);
    let clean = notes::prose(body, true);
    let lines: Vec<_> = safe.lines().collect();
    let clean_lines: Vec<_> = clean.lines().collect();
    let raw: Vec<_> = body.split_inclusive('\n').collect();
    let mut offset = 0;
    let offsets: Vec<_> = raw
        .iter()
        .map(|line| {
            let start = offset;
            offset += line.encode_utf16().count();
            start
        })
        .collect();
    let mut cards = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        let first = i;
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
                cards.push(RecallBlock {
                    content_id: id,
                    question,
                    answer,
                    start: offsets[first]
                        + raw[first]
                            .chars()
                            .take_while(|c| c.is_whitespace())
                            .map(char::len_utf16)
                            .sum::<usize>(),
                    end: offsets[i] + raw[i].trim_end().encode_utf16().count(),
                });
            }
        }
        i += 1;
    }
    cards
}
pub fn parse(note: &Note, content: &str) -> Vec<Card> {
    let body = notes::body(content).map(|(_, b)| b).unwrap_or("");
    let mut seen = BTreeSet::new();
    extract(body)
        .into_iter()
        .filter(|c| seen.insert(c.content_id.clone()))
        .map(|c| Card {
            id: c.content_id.clone(),
            content_id: c.content_id,
            subject_id: note.subject_id.clone(),
            neuron_id: note.neuron_id.clone(),
            source: note.id.clone(),
            subject: note.subject,
            question: c.question,
            answer: c.answer,
        })
        .collect()
}

#[derive(Debug, Serialize)]
pub struct RatingPreview {
    pub rating: Rating,
    pub due: i64,
    pub interval_seconds: i64,
}
#[derive(Debug, Serialize)]
pub struct RatingPreviews {
    pub card_id: String,
    pub reference_time: i64,
    pub options: Vec<RatingPreview>,
}
pub fn previews(id: &str, old: Option<&Review>, now: i64) -> RatingPreviews {
    RatingPreviews {
        card_id: id.into(),
        reference_time: now,
        options: [Rating::Again, Rating::Hard, Rating::Good, Rating::Easy]
            .into_iter()
            .map(|rating| {
                let next = schedule(id, old, rating, now);
                RatingPreview {
                    rating,
                    due: next.due,
                    interval_seconds: next.due - now,
                }
            })
            .collect(),
    }
}
// Both paths load the same validated history; preview never migrates, scans or writes.
pub fn preview_at(root: &Path, id: &str, now: i64) -> Result<RatingPreviews> {
    let (history, _) = load(root)?;
    Ok(previews(id, history.cards.get(id), now))
}
pub fn rate_at(root: &Path, id: &str, rating: Rating, now: i64) -> Result<Review> {
    let (mut history, revision) = load(root)?;
    if history.cards.get(id).is_some_and(|r| r.due > now) {
        return Err(Error::new("card", "This card is not due yet."));
    }
    let next = schedule(id, history.cards.get(id), rating, now);
    history.cards.insert(id.into(), next.clone());
    vault::atomic_write(
        root,
        "flashcards.json",
        &serde_json::to_string_pretty(&history)?,
        revision.as_deref(),
        false,
    )?;
    Ok(next)
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
