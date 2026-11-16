import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Plus, Trash2 } from "lucide-react";
import type { Snapshot } from "../types";
import { message } from "../types";
import {
  blankQuestion,
  type CardDraft,
  type FlashcardDraft,
  type Question,
  type QuizDraft,
  type ReminderDraft,
  type ResolvedReminder,
  type SourceRef,
} from "../study";

export function SourceChoices({
  sources,
  selected,
  onChange,
}: {
  sources: SourceRef[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <fieldset className="source-choices">
      <legend>Source notes</legend>
      {sources.map((source) => (
        <label className="check-option" key={source.id}>
          <input
            type="checkbox"
            checked={selected.includes(source.id)}
            onChange={(e) =>
              onChange(
                e.target.checked
                  ? [...selected, source.id]
                  : selected.filter((id) => id !== source.id),
              )
            }
          />
          {source.title}
        </label>
      ))}
    </fieldset>
  );
}
export function QuizEditor({
  draft,
  sources,
  onChange,
}: {
  draft: QuizDraft;
  sources: SourceRef[];
  onChange: (draft: QuizDraft) => void;
}) {
  function update(index: number, patch: Partial<Question>) {
    onChange({
      ...draft,
      questions: draft.questions.map((q, i) =>
        i === index ? { ...q, ...patch } : q,
      ),
    });
  }
  return (
    <div className="draft-editor">
      <label>
        Quiz title
        <input
          value={draft.title}
          maxLength={160}
          onChange={(e) => onChange({ ...draft, title: e.target.value })}
        />
      </label>
      {draft.questions.map((q, index) => (
        <section className="draft-item" key={q.id}>
          <div className="draft-item-head">
            <select
              aria-label={`Question ${index + 1} type`}
              value={q.kind}
              onChange={(e) =>
                update(
                  index,
                  e.target.value === "multiple_choice"
                    ? {
                        kind: "multiple_choice",
                        options: ["", "", "", ""],
                        correct_index: 0,
                      }
                    : {
                        kind: "short_answer",
                        options: [],
                        correct_index: null,
                      },
                )
              }
            >
              <option value="multiple_choice">Multiple choice</option>
              <option value="short_answer">Short answer</option>
            </select>
            <button
              aria-label={`Remove question ${index + 1}`}
              disabled={draft.questions.length === 1}
              onClick={() =>
                onChange({
                  ...draft,
                  questions: draft.questions.filter((_, i) => i !== index),
                })
              }
            >
              <Trash2 size={16} />
            </button>
          </div>
          <label>
            Question
            <textarea
              aria-label={`Question ${index + 1}`}
              rows={2}
              value={q.prompt}
              maxLength={3000}
              onChange={(e) => update(index, { prompt: e.target.value })}
            />
          </label>
          {q.kind === "multiple_choice" && (
            <fieldset className="quiz-options">
              <legend>Options · select the correct answer</legend>
              {q.options.map((option, j) => (
                <div className="option-editor" key={j}>
                  <input
                    type="radio"
                    name={`correct-${q.id}`}
                    aria-label={`Correct option ${j + 1} for question ${index + 1}`}
                    checked={q.correct_index === j}
                    onChange={() => update(index, { correct_index: j })}
                  />
                  <input
                    aria-label={`Question ${index + 1} option ${j + 1}`}
                    value={option}
                    maxLength={1000}
                    onChange={(e) =>
                      update(index, {
                        options: q.options.map((o, k) =>
                          k === j ? e.target.value : o,
                        ),
                      })
                    }
                  />
                  <button
                    aria-label={`Remove option ${j + 1}`}
                    disabled={q.options.length <= 2}
                    onClick={() =>
                      update(index, {
                        options: q.options.filter((_, k) => k !== j),
                        correct_index: 0,
                      })
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              {q.options.length < 6 && (
                <button
                  onClick={() => update(index, { options: [...q.options, ""] })}
                >
                  <Plus size={14} />
                  Add option
                </button>
              )}
            </fieldset>
          )}
          <label>
            {q.kind === "multiple_choice" ? "Answer" : "Marking guidance"}
            <textarea
              rows={2}
              value={q.answer}
              maxLength={4000}
              onChange={(e) => update(index, { answer: e.target.value })}
            />
          </label>
          <label>
            Explanation
            <textarea
              rows={2}
              value={q.explanation}
              maxLength={4000}
              onChange={(e) => update(index, { explanation: e.target.value })}
            />
          </label>
          <details>
            <summary>Source mapping</summary>
            <SourceChoices
              sources={sources}
              selected={q.sources}
              onChange={(ids) => update(index, { sources: ids })}
            />
          </details>
        </section>
      ))}
      {draft.questions.length < 20 && (
        <button
          onClick={() =>
            onChange({
              ...draft,
              questions: [
                ...draft.questions,
                blankQuestion(sources.slice(0, 1).map((s) => s.id)),
              ],
            })
          }
        >
          <Plus size={16} />
          Add question
        </button>
      )}
    </div>
  );
}
export function FlashcardEditor({
  draft,
  sources,
  onChange,
  selected,
  onSelected,
}: {
  draft: FlashcardDraft;
  sources: SourceRef[];
  onChange: (draft: FlashcardDraft) => void;
  selected: Set<number>;
  onSelected: (selected: Set<number>) => void;
}) {
  function update(index: number, patch: Partial<CardDraft>) {
    onChange({
      ...draft,
      cards: draft.cards.map((c, i) => (i === index ? { ...c, ...patch } : c)),
    });
  }
  return (
    <div className="draft-editor">
      <label>
        Draft title
        <input
          value={draft.title}
          maxLength={160}
          onChange={(e) => onChange({ ...draft, title: e.target.value })}
        />
      </label>
      {draft.cards.map((c, index) => (
        <section className="draft-item" key={index}>
          <div className="draft-item-head">
            <label className="check-option">
              <input
                type="checkbox"
                checked={selected.has(index)}
                onChange={(e) => {
                  const next = new Set(selected);
                  if (e.target.checked) next.add(index);
                  else next.delete(index);
                  onSelected(next);
                }}
              />
              Save this card
            </label>
            <button
              aria-label={`Remove card ${index + 1}`}
              disabled={draft.cards.length === 1}
              onClick={() => {
                onChange({
                  ...draft,
                  cards: draft.cards.filter((_, i) => i !== index),
                });
                onSelected(
                  new Set(
                    [...selected]
                      .filter((i) => i !== index)
                      .map((i) => (i > index ? i - 1 : i)),
                  ),
                );
              }}
            >
              <Trash2 size={16} />
            </button>
          </div>
          <label>
            Question
            <textarea
              aria-label={`Card ${index + 1} question`}
              rows={2}
              value={c.question}
              maxLength={2000}
              onChange={(e) => update(index, { question: e.target.value })}
            />
          </label>
          <label>
            Answer
            <textarea
              aria-label={`Card ${index + 1} answer`}
              rows={3}
              value={c.answer}
              maxLength={6000}
              onChange={(e) => update(index, { answer: e.target.value })}
            />
          </label>
          <details>
            <summary>Source mapping</summary>
            <SourceChoices
              sources={sources}
              selected={c.sources}
              onChange={(ids) => update(index, { sources: ids })}
            />
          </details>
        </section>
      ))}
      {draft.cards.length < 20 && (
        <button
          onClick={() => {
            onSelected(new Set([...selected, draft.cards.length]));
            onChange({
              ...draft,
              cards: [
                ...draft.cards,
                {
                  question: "",
                  answer: "",
                  sources: sources.slice(0, 1).map((s) => s.id),
                },
              ],
            });
          }}
        >
          <Plus size={16} />
          Add card
        </button>
      )}
    </div>
  );
}
export function ReminderEditor({
  draft,
  snapshot,
  onChange,
  onValidity,
}: {
  draft: ReminderDraft;
  snapshot: Snapshot;
  onChange: (draft: ReminderDraft) => void;
  onValidity: (valid: boolean) => void;
}) {
  const [resolution, setResolution] = useState<{
    key: string;
    data?: ResolvedReminder;
    error?: string;
  }>();
  const key = JSON.stringify(draft);
  useEffect(() => {
    let active = true;
    onValidity(false);
    const timer = setTimeout(() => {
      invoke<ResolvedReminder>("preview_reminder", { draft: JSON.parse(key) })
        .then((data) => {
          if (active) {
            setResolution({ key, data });
            onValidity(true);
          }
        })
        .catch((e) => {
          if (active) {
            setResolution({ key, error: message(e) });
            onValidity(false);
          }
        });
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [key, onValidity]);
  const notes = snapshot.notes.filter(
    (n) => !draft.subject_id || n.subject_id === draft.subject_id,
  );
  return (
    <div className="draft-editor reminder-editor">
      <label>
        Reminder title
        <input
          aria-label="Reminder title"
          maxLength={160}
          value={draft.title}
          onChange={(e) => onChange({ ...draft, title: e.target.value })}
        />
      </label>
      <div className="form-pair">
        <label>
          Date and time
          <input
            aria-label="Reminder date and time"
            type="datetime-local"
            step={1}
            value={draft.local_at}
            onChange={(e) => onChange({ ...draft, local_at: e.target.value })}
          />
        </label>
        <label>
          Timezone
          <input
            aria-label="Reminder timezone"
            value={draft.timezone}
            onChange={(e) => onChange({ ...draft, timezone: e.target.value })}
          />
        </label>
      </div>
      <div className="form-pair">
        <label>
          Repeat
          <select
            value={draft.repetition}
            onChange={(e) =>
              onChange({
                ...draft,
                repetition: e.target.value as ReminderDraft["repetition"],
              })
            }
          >
            <option value="none">Once</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </select>
        </label>
        <label>
          Repeated clock hour
          <select
            value={draft.fold ?? ""}
            onChange={(e) =>
              onChange({
                ...draft,
                fold: (e.target.value || null) as ReminderDraft["fold"],
              })
            }
          >
            <option value="">Ask if ambiguous</option>
            <option value="earlier">Earlier occurrence</option>
            <option value="later">Later occurrence</option>
          </select>
        </label>
      </div>
      <label>
        Target subject
        <select
          aria-label="Reminder target subject"
          value={draft.subject_id ?? ""}
          onChange={(e) =>
            onChange({
              ...draft,
              subject_id: e.target.value || null,
              source_id: null,
            })
          }
        >
          <option value="">No subject</option>
          {snapshot.organization.subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {
                snapshot.organization.neurons.find((n) => n.id === s.neuron_id)
                  ?.name
              }{" "}
              / {s.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Target note
        <select
          aria-label="Reminder target note"
          value={draft.source_id ?? ""}
          onChange={(e) =>
            onChange({
              ...draft,
              source_id: e.target.value || null,
              subject_id:
                notes.find((n) => n.id === e.target.value)?.subject_id ??
                draft.subject_id,
            })
          }
        >
          <option value="">Subject only / no note</option>
          {notes.map((n) => (
            <option key={n.id} value={n.id}>
              {n.title}
            </option>
          ))}
        </select>
      </label>
      {draft.clarification && (
        <div className="clarification">
          <p>{draft.clarification}</p>
          <button onClick={() => onChange({ ...draft, clarification: null })}>
            I’ve clarified the details above
          </button>
        </div>
      )}
      {resolution?.key === key && resolution.data && (
        <p className="resolved-reminder" role="status">
          {resolution.data.display}
          <br />
          <span className="muted">
            {draft.repetition === "none"
              ? "Once"
              : `${draft.repetition === "daily" ? "Daily" : "Weekly"} at this local time`}
          </span>
        </p>
      )}
      {resolution?.key === key && resolution.error && (
        <p className="form-error" role="alert">
          {resolution.error}
        </p>
      )}
      <p className="muted">
        Delivery is local while Synapse runs. Missed reminders appear in Study
        library. Daily and weekly reminders keep local time across
        daylight-saving changes.
      </p>
    </div>
  );
}
