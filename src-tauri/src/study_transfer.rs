// Portable study definitions. Device registrations, API usage and save receipts
// never enter a package. External references remain visibly external.
use crate::{
    errors::Result,
    study::{self, Attempt, FlashcardBatch, Quiz, Reminder, SourceRef, Store},
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Portable {
    pub quizzes: Vec<Quiz>,
    pub attempts: Vec<Attempt>,
    pub reminders: Vec<Reminder>,
    pub flashcard_batches: Vec<FlashcardBatch>,
}
impl Portable {
    fn store(&self) -> Store {
        Store {
            quizzes: self.quizzes.clone(),
            attempts: self.attempts.clone(),
            reminders: self.reminders.clone(),
            flashcard_batches: self.flashcard_batches.clone(),
            ..Store::default()
        }
    }
    pub fn validate(&self, subject: &str, notes: &BTreeSet<String>) -> Result<()> {
        study::validate(&self.store())?;
        for refs in self
            .quizzes
            .iter()
            .map(|q| &q.sources)
            .chain(self.flashcard_batches.iter().map(|b| &b.sources))
        {
            for s in refs {
                if !s.external && (s.subject_id != subject || !notes.contains(&s.id)) {
                    return Err(study::invalid(
                        "A packaged source reference is missing its note",
                    ));
                }
            }
        }
        if self.quizzes.iter().any(|q| q.subject_id != subject)
            || self
                .flashcard_batches
                .iter()
                .any(|b| b.subject_id != subject || !notes.contains(&b.note_id))
            || self.reminders.iter().any(|r| {
                r.enabled
                    || r.next_due.is_some()
                    || r.pending_due.is_some()
                    || r.last_delivered.is_some()
                    || r.draft.subject_id.as_deref() != Some(subject)
                    || r.draft
                        .source_id
                        .as_ref()
                        .is_some_and(|id| !notes.contains(id))
            })
        {
            return Err(study::invalid(
                "Invalid portable study ownership or active reminder",
            ));
        }
        Ok(())
    }
}
fn map_refs(
    refs: &mut [SourceRef],
    mapping: &BTreeMap<String, String>,
    subject: &str,
    exporting: bool,
) -> BTreeMap<String, String> {
    let mut changed = BTreeMap::new();
    for s in refs {
        if !s.external {
            if let Some(id) = mapping.get(&s.id) {
                changed.insert(s.id.clone(), id.clone());
                s.id = id.clone();
                s.subject_id = subject.into();
            } else if exporting {
                s.external = true;
            }
        }
    }
    changed
}
fn pause(reminder: &mut Reminder) {
    reminder.enabled = false;
    reminder.next_due = None;
    reminder.pending_due = None;
    reminder.last_delivered = None;
}
fn remap(
    portable: &mut Portable,
    subject: &str,
    mapping: &BTreeMap<String, String>,
    exporting: bool,
) {
    for q in &mut portable.quizzes {
        q.subject_id = subject.into();
        let refs = map_refs(&mut q.sources, mapping, subject, exporting);
        for question in &mut q.draft.questions {
            for s in &mut question.sources {
                if let Some(id) = refs.get(s) {
                    *s = id.clone();
                }
            }
        }
    }
    for b in &mut portable.flashcard_batches {
        b.subject_id = subject.into();
        b.note_id = mapping[&b.note_id].clone();
        let refs = map_refs(&mut b.sources, mapping, subject, exporting);
        for card in &mut b.draft.cards {
            for s in &mut card.sources {
                if let Some(id) = refs.get(s) {
                    *s = id.clone();
                }
            }
        }
    }
    for r in &mut portable.reminders {
        r.draft.subject_id = Some(subject.into());
        r.draft.source_id = r
            .draft
            .source_id
            .as_ref()
            .and_then(|s| mapping.get(s))
            .cloned();
        pause(r);
    }
}
pub fn export(
    store: &Store,
    subject: &str,
    mapping: &BTreeMap<String, String>,
    history: bool,
) -> Result<Option<Portable>> {
    let quizzes: Vec<_> = store
        .quizzes
        .iter()
        .filter(|q| q.subject_id == subject)
        .cloned()
        .collect();
    let attempts = store
        .attempts
        .iter()
        .filter(|a| history && quizzes.iter().any(|q| q.id == a.quiz_id))
        .cloned()
        .collect();
    let reminders = store
        .reminders
        .iter()
        .filter(|r| {
            r.draft.subject_id.as_deref() == Some(subject)
                || r.draft
                    .source_id
                    .as_ref()
                    .is_some_and(|id| mapping.contains_key(id))
        })
        .cloned()
        .collect();
    let flashcard_batches = store
        .flashcard_batches
        .iter()
        .filter(|b| b.subject_id == subject && mapping.contains_key(&b.note_id))
        .cloned()
        .collect();
    let mut p = Portable {
        quizzes,
        attempts,
        reminders,
        flashcard_batches,
    };
    if p.quizzes.is_empty() && p.reminders.is_empty() && p.flashcard_batches.is_empty() {
        return Ok(None);
    }
    remap(&mut p, subject, mapping, true);
    p.validate(subject, &mapping.values().cloned().collect())?;
    Ok(Some(p))
}
pub fn import(
    store: &mut Store,
    portable: &Portable,
    subject: &str,
    destination: &str,
    note_ids: &[String],
    history: bool,
) -> Result<()> {
    let mapping = note_ids
        .iter()
        .map(|n| (n.clone(), format!("{destination}/{n}")))
        .collect();
    let mut p = portable.clone();
    remap(&mut p, subject, &mapping, false);
    let mut quiz_ids = BTreeMap::new();
    for q in &mut p.quizzes {
        let next = study::id();
        quiz_ids.insert(q.id.clone(), next.clone());
        q.id = next;
    }
    for a in &mut p.attempts {
        a.id = study::id();
        a.quiz_id = quiz_ids[&a.quiz_id].clone();
    }
    for r in &mut p.reminders {
        r.id = study::id();
    }
    for b in &mut p.flashcard_batches {
        b.id = study::id();
    }
    store.quizzes.extend(p.quizzes);
    if history {
        store.attempts.extend(p.attempts);
    }
    store.reminders.extend(p.reminders);
    store.flashcard_batches.extend(p.flashcard_batches);
    study::validate(store)
}
