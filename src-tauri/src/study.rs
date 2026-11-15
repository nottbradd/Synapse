use crate::{
    errors::{Error, Result},
    notes, organization, vault,
};
use chrono::{DateTime, Datelike, Duration, LocalResult, NaiveDateTime, TimeZone, Utc};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
};

pub const MAX_NOTES: usize = 20;
pub const MAX_CONTEXT: usize = 60_000;
pub const MAX_NOTE: usize = 16_000;
pub const MAX_ITEMS: usize = 20;
pub fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}
pub fn now() -> i64 {
    Utc::now().timestamp()
}
pub fn invalid(message: &str) -> Error {
    Error::new("study", message)
}
pub fn text(value: &str, max: usize, label: &str) -> Result<()> {
    if value.trim().is_empty() || value.len() > max || value.contains('\0') {
        return Err(invalid(&format!(
            "{label} is empty or exceeds its {max}-byte limit"
        )));
    }
    Ok(())
}
pub fn uuid(value: &str) -> Result<()> {
    uuid::Uuid::parse_str(value).map_err(|_| invalid("Invalid study identifier"))?;
    Ok(())
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SourceRef {
    pub id: String,
    pub title: String,
    pub revision: String,
    pub subject_id: String,
    #[serde(default)]
    pub external: bool,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QuestionKind {
    MultipleChoice,
    ShortAnswer,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Question {
    #[serde(default = "id")]
    pub id: String,
    pub kind: QuestionKind,
    pub prompt: String,
    pub options: Vec<String>,
    pub correct_index: Option<usize>,
    pub answer: String,
    pub explanation: String,
    pub sources: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct QuizDraft {
    pub title: String,
    pub questions: Vec<Question>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CardDraft {
    pub question: String,
    pub answer: String,
    pub sources: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FlashcardDraft {
    pub title: String,
    pub cards: Vec<CardDraft>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Repetition {
    None,
    Daily,
    Weekly,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReminderDraft {
    pub title: String,
    pub local_at: String,
    pub timezone: String,
    pub repetition: Repetition,
    pub source_id: Option<String>,
    pub subject_id: Option<String>,
    pub fold: Option<String>,
    pub clarification: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Quiz {
    pub id: String,
    pub subject_id: String,
    pub created_at: i64,
    pub draft: QuizDraft,
    pub sources: Vec<SourceRef>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Answer {
    pub question_id: String,
    pub option: Option<usize>,
    pub response: String,
    pub self_assessed: Option<bool>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Attempt {
    pub id: String,
    pub quiz_id: String,
    pub completed_at: i64,
    pub answers: Vec<Answer>,
    pub correct: usize,
    pub total: usize,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Reminder {
    pub id: String,
    pub draft: ReminderDraft,
    pub enabled: bool,
    pub next_due: Option<i64>,
    pub pending_due: Option<i64>,
    pub last_delivered: Option<i64>,
    pub created_at: i64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Receipt {
    pub kind: String,
    pub target: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FlashcardBatch {
    pub id: String,
    pub subject_id: String,
    pub note_id: String,
    pub created_at: i64,
    pub draft: FlashcardDraft,
    pub sources: Vec<SourceRef>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Store {
    pub schema_version: u32,
    pub quizzes: Vec<Quiz>,
    pub attempts: Vec<Attempt>,
    pub reminders: Vec<Reminder>,
    pub receipts: BTreeMap<String, Receipt>,
    #[serde(default)]
    pub flashcard_batches: Vec<FlashcardBatch>,
}
impl Default for Store {
    fn default() -> Self {
        Self {
            schema_version: 1,
            quizzes: vec![],
            attempts: vec![],
            reminders: vec![],
            receipts: BTreeMap::new(),
            flashcard_batches: vec![],
        }
    }
}
#[derive(Serialize)]
pub struct View {
    pub data: Store,
    pub revision: Option<String>,
}
pub fn source_ids(sources: &[SourceRef]) -> BTreeSet<String> {
    sources.iter().map(|s| s.id.clone()).collect()
}
pub fn note_id(value: &str) -> Result<()> {
    text(value, 1000, "Source note identifier")?;
    if value.contains(['\\', ':', '\r', '\n'])
        || value.starts_with('/')
        || !value.to_lowercase().ends_with(".md")
        || value
            .split('/')
            .any(|p| p.is_empty() || p == "." || p == ".." || p == ".synapse")
    {
        return Err(invalid("Invalid source note identifier"));
    }
    Ok(())
}
pub fn validate_refs(sources: &[SourceRef]) -> Result<()> {
    if sources.len() > MAX_NOTES || source_ids(sources).len() != sources.len() {
        return Err(invalid("Invalid source mapping"));
    }
    for s in sources {
        note_id(&s.id)?;
        text(&s.title, 1000, "Source title")?;
        uuid(&s.subject_id)?;
        if !organization::hash_id(&s.revision) {
            return Err(invalid("Invalid source revision"));
        }
    }
    Ok(())
}
pub fn validate_sources(ids: &[String], allowed: &BTreeSet<String>) -> Result<()> {
    if ids.is_empty()
        || ids.len() > MAX_NOTES
        || ids.iter().any(|id| !allowed.contains(id))
        || ids.iter().collect::<BTreeSet<_>>().len() != ids.len()
    {
        return Err(invalid(
            "Every item must reference selected source notes, without duplicates",
        ));
    }
    Ok(())
}
pub fn validate_quiz(draft: &QuizDraft, allowed: &BTreeSet<String>) -> Result<()> {
    text(&draft.title, 160, "Quiz title")?;
    if draft.questions.is_empty() || draft.questions.len() > MAX_ITEMS {
        return Err(invalid("Choose between 1 and 20 questions"));
    }
    let mut seen = BTreeSet::new();
    for q in &draft.questions {
        uuid(&q.id)?;
        if !seen.insert(&q.id) {
            return Err(invalid("Question identifiers must be unique"));
        }
        text(&q.prompt, 3000, "Question")?;
        text(&q.answer, 4000, "Marking guidance")?;
        text(&q.explanation, 4000, "Explanation")?;
        validate_sources(&q.sources, allowed)?;
        match q.kind {
            QuestionKind::MultipleChoice => {
                if !(2..=6).contains(&q.options.len())
                    || q.correct_index.is_none_or(|i| i >= q.options.len())
                {
                    return Err(invalid(
                        "Multiple-choice questions need 2–6 options and a valid correct option",
                    ));
                }
                for o in &q.options {
                    text(o, 1000, "Option")?;
                }
                if q.options
                    .iter()
                    .map(|s| s.trim().to_lowercase())
                    .collect::<BTreeSet<_>>()
                    .len()
                    != q.options.len()
                {
                    return Err(invalid("Multiple-choice options must be distinct"));
                }
            }
            QuestionKind::ShortAnswer if !q.options.is_empty() || q.correct_index.is_some() => {
                return Err(invalid(
                    "Short-answer questions cannot contain multiple-choice options",
                ))
            }
            _ => {}
        }
    }
    Ok(())
}
pub fn validate_cards(draft: &FlashcardDraft, allowed: &BTreeSet<String>) -> Result<()> {
    text(&draft.title, 160, "Flashcard title")?;
    if draft.cards.is_empty() || draft.cards.len() > MAX_ITEMS {
        return Err(invalid("Choose between 1 and 20 flashcards"));
    }
    for c in &draft.cards {
        text(&c.question, 2000, "Question")?;
        text(&c.answer, 6000, "Answer")?;
        validate_sources(&c.sources, allowed)?;
        let canonical = format!("Q: {}\nA: {}\n", c.question.trim(), c.answer.trim());
        let presentation = crate::flashcards::presentation(&canonical)?;
        if presentation.recalls.len() != 1
            || presentation.recalls[0].question != c.question.trim()
            || presentation.recalls[0].answer != c.answer.trim()
        {
            return Err(invalid("A flashcard cannot round-trip through Q:/A: format. Keep questions on one line and remove blank lines or new card markers inside answers."));
        }
    }
    Ok(())
}
pub fn mark(quiz: &Quiz, attempt_id: &str, answers: Vec<Answer>, at: i64) -> Result<Attempt> {
    uuid(attempt_id)?;
    if answers.len() != quiz.draft.questions.len() {
        return Err(invalid("Answer every question before finishing"));
    }
    let mut seen = BTreeSet::new();
    let mut correct = 0;
    for answer in &answers {
        if !seen.insert(&answer.question_id) || answer.response.len() > 8000 {
            return Err(invalid("Invalid or duplicate answer"));
        }
        let q = quiz
            .draft
            .questions
            .iter()
            .find(|q| q.id == answer.question_id)
            .ok_or_else(|| invalid("Unknown question"))?;
        match q.kind {
            QuestionKind::MultipleChoice => {
                if answer.option.is_none_or(|i| i >= q.options.len())
                    || answer.self_assessed.is_some()
                {
                    return Err(invalid("Choose one valid option"));
                }
                correct += usize::from(answer.option == q.correct_index);
            }
            QuestionKind::ShortAnswer => {
                if answer.option.is_some() || answer.self_assessed.is_none() {
                    return Err(invalid(
                        "Self-assess short answers using the marking guidance",
                    ));
                }
                correct += usize::from(answer.self_assessed == Some(true));
            }
        }
    }
    Ok(Attempt {
        id: attempt_id.into(),
        quiz_id: quiz.id.clone(),
        completed_at: at,
        total: answers.len(),
        answers,
        correct,
    })
}
pub fn timezone(value: &str) -> Result<Tz> {
    value
        .parse()
        .map_err(|_| invalid("Choose a valid IANA timezone, such as Australia/Sydney"))
}
pub fn local(value: &str) -> Result<NaiveDateTime> {
    NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M:%S")
        .or_else(|_| NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M"))
        .map_err(|_| invalid("Enter a valid local date and time"))
}
fn resolve(tz: Tz, wall: NaiveDateTime, fold: Option<&str>) -> Result<DateTime<Tz>> {
    match tz.from_local_datetime(&wall) {
        LocalResult::Single(t) => Ok(t),
        LocalResult::None => Err(invalid("This local time does not exist during the daylight-saving change. Choose another time.")),
        LocalResult::Ambiguous(a, b) => match fold {
            Some("earlier") => Ok(a.min(b)), Some("later") => Ok(a.max(b)),
            _ => Err(invalid("This time occurs twice during the daylight-saving change. Choose the earlier or later occurrence.")),
        }
    }
}
#[derive(Serialize)]
pub struct ResolvedReminder {
    pub due: i64,
    pub display: String,
    pub reference_time: i64,
}
pub fn resolve_reminder(d: &ReminderDraft, at: i64, future: bool) -> Result<ResolvedReminder> {
    text(&d.title, 160, "Reminder title")?;
    if let Some(source) = &d.source_id {
        note_id(source)?;
    }
    if let Some(subject) = &d.subject_id {
        uuid(subject)?;
    }
    if local(&d.local_at)?.date().year() < 1970 || local(&d.local_at)?.date().year() > 2200 {
        return Err(invalid("Choose a reminder date between 1970 and 2200"));
    }
    if d.fold
        .as_deref()
        .is_some_and(|f| f != "earlier" && f != "later")
    {
        return Err(invalid("Invalid daylight-saving occurrence"));
    }
    if d.clarification
        .as_ref()
        .is_some_and(|s| !s.trim().is_empty())
    {
        return Err(invalid(
            "Resolve the reminder clarification and clear it before saving",
        ));
    }
    let t = resolve(
        timezone(&d.timezone)?,
        local(&d.local_at)?,
        d.fold.as_deref(),
    )?;
    if future && t.timestamp() <= at {
        return Err(invalid(
            "This reminder is in the past. Choose a future date and time.",
        ));
    }
    Ok(ResolvedReminder {
        due: t.timestamp(),
        display: t.format("%a %-d %b %Y, %H:%M:%S %Z (%:z)").to_string(),
        reference_time: at,
    })
}
// Recurrences retain wall-clock time. A spring gap advances to the first valid
// minute; autumn repeats use the explicitly selected fold, or the earlier one.
pub fn next_occurrence(d: &ReminderDraft, after: i64) -> Result<Option<i64>> {
    let days = match d.repetition {
        Repetition::None => return Ok(None),
        Repetition::Daily => 1,
        Repetition::Weekly => 7,
    };
    let tz = timezone(&d.timezone)?;
    let original = local(&d.local_at)?;
    let current = DateTime::from_timestamp(after, 0)
        .ok_or_else(|| invalid("Invalid reminder timestamp"))?
        .with_timezone(&tz)
        .naive_local();
    let elapsed = (current.date() - original.date()).num_days().max(0);
    let mut wall = original + Duration::days((elapsed / days) * days);
    for _ in 0..4 {
        for offset in 0..=180 {
            let candidate = wall + Duration::minutes(offset);
            if let Ok(t) = resolve(tz, candidate, d.fold.as_deref().or(Some("earlier"))) {
                if t.timestamp() > after {
                    return Ok(Some(t.timestamp()));
                }
                break;
            }
        }
        wall += Duration::days(days);
    }
    Err(invalid("Unable to resolve the next reminder occurrence"))
}
pub struct Delivery {
    pub id: String,
    pub title: String,
    pub due: i64,
}
pub fn advance(store: &mut Store, at: i64) -> Result<Vec<Delivery>> {
    let mut deliveries = vec![];
    for r in &mut store.reminders {
        if !r.enabled {
            continue;
        }
        if let Some(due) = r.next_due.filter(|due| *due <= at) {
            if r.last_delivered != Some(due) {
                r.pending_due = Some(due);
                r.last_delivered = Some(due);
                deliveries.push(Delivery {
                    id: r.id.clone(),
                    title: r.draft.title.clone(),
                    due,
                });
            }
            r.next_due = next_occurrence(&r.draft, at)?;
        }
    }
    Ok(deliveries)
}
pub fn validate(store: &Store) -> Result<()> {
    let timestamp = |value: i64| -> Result<()> {
        if (0..=7_289_654_400).contains(&value) {
            Ok(())
        } else {
            Err(invalid("Study metadata contains an invalid date"))
        }
    };
    if store.schema_version != 1
        || store.quizzes.len() > 500
        || store.attempts.len() > 2000
        || store.reminders.len() > 500
        || store.receipts.len() > 4000
        || store.flashcard_batches.len() > 1000
    {
        return Err(invalid(
            "Unsupported study metadata or study storage limit reached",
        ));
    }
    let mut ids = BTreeSet::new();
    for q in &store.quizzes {
        timestamp(q.created_at)?;
        uuid(&q.id)?;
        uuid(&q.subject_id)?;
        if !ids.insert(&q.id) || q.sources.len() > MAX_NOTES {
            return Err(invalid("Duplicate quiz or too many source notes"));
        }
        validate_quiz(&q.draft, &source_ids(&q.sources))?;
        validate_refs(&q.sources)?;
    }
    let mut attempts = BTreeSet::new();
    for a in &store.attempts {
        timestamp(a.completed_at)?;
        if !attempts.insert(&a.id) {
            return Err(invalid("Duplicate quiz attempt"));
        }
        let q = store
            .quizzes
            .iter()
            .find(|q| q.id == a.quiz_id)
            .ok_or_else(|| invalid("Quiz attempt references an unknown quiz"))?;
        let expected = mark(q, &a.id, a.answers.clone(), a.completed_at)?;
        if a.correct != expected.correct || a.total != expected.total {
            return Err(invalid("Quiz attempt score does not match its answers"));
        }
    }
    let mut reminders = BTreeSet::new();
    let mut batches = BTreeSet::new();
    for b in &store.flashcard_batches {
        timestamp(b.created_at)?;
        uuid(&b.id)?;
        uuid(&b.subject_id)?;
        note_id(&b.note_id)?;
        if !batches.insert(&b.id) {
            return Err(invalid("Duplicate flashcard batch"));
        }
        validate_refs(&b.sources)?;
        validate_cards(&b.draft, &source_ids(&b.sources))?;
    }
    for r in &store.reminders {
        timestamp(r.created_at)?;
        for time in [r.next_due, r.pending_due, r.last_delivered]
            .into_iter()
            .flatten()
        {
            timestamp(time)?;
        }
        uuid(&r.id)?;
        if !reminders.insert(&r.id) {
            return Err(invalid("Duplicate reminder"));
        }
        resolve_reminder(&r.draft, now(), false)?;
        if r.draft
            .subject_id
            .as_deref()
            .is_some_and(|s| uuid(s).is_err())
        {
            return Err(invalid("Invalid reminder subject"));
        }
    }
    for (key, receipt) in &store.receipts {
        uuid(key)?;
        text(&receipt.target, 1000, "Saved target")?;
        if !["quiz", "flashcards", "reminder"].contains(&receipt.kind.as_str()) {
            return Err(invalid("Unknown saved study type"));
        }
    }
    Ok(())
}
pub fn load(root: &Path) -> Result<View> {
    let meta = organization::area(root)?;
    let path = vault::contained(&meta, "study.json", false)?;
    if !path.exists() {
        return Ok(View {
            data: Store::default(),
            revision: None,
        });
    }
    if std::fs::metadata(&path)?.len() > 8 * 1024 * 1024 {
        return Err(invalid(
            "Study metadata exceeds 8 MiB; the file was preserved",
        ));
    }
    let raw = std::fs::read_to_string(path)?;
    let data: Store = serde_json::from_str(&raw)
        .map_err(|_| invalid("Study metadata is invalid; the original file was preserved"))?;
    validate(&data)?;
    Ok(View {
        data,
        revision: Some(notes::hash(&raw)),
    })
}
pub fn save(root: &Path, data: &Store, revision: Option<&str>) -> Result<()> {
    validate(data)?;
    let raw = serde_json::to_string_pretty(data)?;
    if raw.len() > 8 * 1024 * 1024 {
        return Err(invalid("Study storage exceeds 8 MiB"));
    }
    vault::atomic_write(
        &organization::area(root)?,
        "study.json",
        &raw,
        revision,
        false,
    )?;
    Ok(())
}
