import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowLeft,
  Check,
  FileText,
  LoaderCircle,
  Plus,
  X,
} from "lucide-react";
import type { Snapshot } from "../types";
import { message } from "../types";
import {
  blankQuestion,
  localDateTime,
  type Attempt,
  type DeviceSettings,
  type Generated,
  type Quiz,
  type Reminder,
  type ReminderDraft,
  type StudyContext,
  type StudyDraft,
  type StudyKind,
  type StudyView,
} from "../study";
import { feedback } from "../interaction/events";
import { FlashcardEditor, QuizEditor, ReminderEditor } from "./StudyEditors";
import QuizPlayer from "./QuizPlayer";

type Working = { id: string; draft: StudyDraft; context: StudyContext };
export default function StudyPanel({
  snapshot,
  currentNote,
  initialView,
  view,
  loadError,
  onRefresh,
  onSnapshot,
  onOpen,
  onClose,
  onSettings,
}: {
  snapshot: Snapshot;
  currentNote?: string;
  initialView: "create" | "library";
  view?: StudyView;
  loadError?: string;
  onRefresh: () => Promise<void>;
  onSnapshot: (snapshot: Snapshot) => void;
  onOpen: (id: string) => void;
  onClose: () => void;
  onSettings: () => void;
}) {
  const [screen, setScreen] = useState(initialView),
    [kind, setKind] = useState<StudyKind>("quiz"),
    [libraryTab, setLibraryTab] = useState<"quizzes" | "reminders">("quizzes");
  const [settings, setSettings] = useState<DeviceSettings>(),
    [sourceMode, setSourceMode] = useState(currentNote ? "note" : "subject"),
    [sourceSubject, setSourceSubject] = useState(
      snapshot.organization.location.subject_id ??
        snapshot.notes.find((n) => n.id === currentNote)?.subject_id ??
        snapshot.notes.find(
          (n) =>
            !snapshot.organization.location.neuron_id ||
            n.neuron_id === snapshot.organization.location.neuron_id,
        )?.subject_id ??
        "",
    ),
    [chosen, setChosen] = useState<string[]>(currentNote ? [currentNote] : []);
  const [contextResult, setContextResult] = useState<{
      key: string;
      value?: StudyContext;
      error?: string;
    }>(),
    [working, setWorking] = useState<Working>(),
    [prompt, setPrompt] = useState(""),
    [count, setCount] = useState(5),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [closing, setClosing] = useState(false);
  const [selectedCards, setSelectedCards] = useState<Set<number>>(new Set()),
    [destinationSubject, setDestinationSubject] = useState(sourceSubject),
    [destinationNote, setDestinationNote] = useState(""),
    [destinationRevision, setDestinationRevision] = useState<string | null>(
      null,
    ),
    [newPath, setNewPath] = useState("Study flashcards.md"),
    [reminderValid, setReminderValid] = useState(false);
  const [playing, setPlaying] = useState<{ quiz: Quiz; attempt?: Attempt }>(),
    [editingReminder, setEditingReminder] = useState<{
      id: string;
      draft: ReminderDraft;
      revision: string;
    }>();
  const sequence = useRef(0),
    pendingScreen = useRef<"create" | "library" | null>(null),
    activeRequest = useRef<string | null>(null),
    saveLock = useRef(false);
  const scope = snapshot.organization.location;
  const scopedNotes = snapshot.notes.filter(
    (n) =>
      (!scope.subject_id || n.subject_id === scope.subject_id) &&
      (!scope.neuron_id || n.neuron_id === scope.neuron_id),
  );
  const sourceIds = useMemo(
    () =>
      sourceMode === "note"
        ? currentNote
          ? [currentNote]
          : []
        : sourceMode === "subject"
          ? snapshot.notes
              .filter((n) => n.subject_id === sourceSubject)
              .map((n) => n.id)
          : chosen,
    [sourceMode, currentNote, snapshot.notes, sourceSubject, chosen],
  );
  const contextKey = JSON.stringify([
    snapshot.root,
    kind,
    sourceIds,
    sourceIds.map((id) => snapshot.notes.find((n) => n.id === id)?.revision),
  ]);
  const context =
    contextResult?.key === contextKey ? contextResult.value : undefined;
  const contextError =
    contextResult?.key === contextKey ? contextResult.error : undefined;
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void invoke<DeviceSettings>("device_settings")
        .then((s) => {
          if (active) setSettings(s);
        })
        .catch((e) => {
          if (active) setError(message(e));
        });
    };
    refresh();
    window.addEventListener("synapse-settings-changed", refresh);
    return () => {
      active = false;
      window.removeEventListener("synapse-settings-changed", refresh);
    };
  }, []);
  useEffect(() => {
    if (working || screen !== "create") return;
    let active = true;
    invoke<StudyContext>("study_context", {
      vaultRoot: snapshot.root,
      sourceIds,
      kind,
    })
      .then((value) => {
        if (active) setContextResult({ key: contextKey, value });
      })
      .catch((e) => {
        if (active) setContextResult({ key: contextKey, error: message(e) });
      });
    return () => {
      active = false;
    };
    // contextKey includes source IDs/revisions, task and vault.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextKey, working, screen]);
  useEffect(
    () => () => {
      sequence.current++;
      void invoke("cancel_study", { requestId: null });
      feedback.cancel();
    },
    [],
  );
  function cancel() {
    sequence.current++;
    if (activeRequest.current)
      void invoke("cancel_study", { requestId: activeRequest.current });
    activeRequest.current = null;
    setBusy(false);
    setNotice(
      "Generation cancelled; a request already received by OpenAI may still incur usage",
    );
    feedback.cancel();
  }
  function discard() {
    if (working) void invoke("cancel_study", { requestId: working.id });
    setWorking(undefined);
    setError("");
    setNotice("");
    setClosing(false);
  }
  function close() {
    pendingScreen.current = null;
    if (busy) cancel();
    if (working || editingReminder) setClosing(true);
    else onClose();
  }
  useEffect(() => {
    const change = (event: Event) => {
      const next = (event as CustomEvent<"create" | "library">).detail;
      if (busy) cancel();
      if (working || editingReminder) {
        pendingScreen.current = next;
        setClosing(true);
      } else {
        setPlaying(undefined);
        setScreen(next);
      }
    };
    window.addEventListener("synapse-study-screen", change);
    return () => window.removeEventListener("synapse-study-screen", change);
  });
  function accept(id: string, draft: StudyDraft, source: StudyContext) {
    setWorking({ id, draft, context: source });
    if (draft.kind === "flashcards")
      setSelectedCards(new Set(draft.data.cards.map((_, i) => i)));
    setNotice("");
  }
  async function start(manual: boolean) {
    if (busy || !context) return;
    const source = context,
      serial = ++sequence.current;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (manual) {
        const id = await invoke<string>("start_study_draft", {
          contextToken: source.token,
        });
        if (serial !== sequence.current) return;
        const ids = source.sources.slice(0, 1).map((s) => s.id);
        const draft: StudyDraft =
          kind === "quiz"
            ? { kind, data: { title: "", questions: [blankQuestion(ids)] } }
            : kind === "flashcards"
              ? {
                  kind,
                  data: {
                    title: "",
                    cards: [{ question: "", answer: "", sources: ids }],
                  },
                }
              : {
                  kind,
                  data: {
                    title: "",
                    local_at: localDateTime(
                      settings?.timezone ?? "Australia/Sydney",
                    ),
                    timezone: settings?.timezone ?? "Australia/Sydney",
                    repetition: "none",
                    source_id: ids[0] ?? null,
                    subject_id:
                      source.sources[0]?.subject_id ?? scope.subject_id,
                    fold: null,
                    clarification: null,
                  },
                };
        accept(id, draft, source);
      } else {
        const id = crypto.randomUUID();
        activeRequest.current = id;
        const generated = await invoke<Generated>("generate_study", {
          request: {
            context_token: source.token,
            request_id: id,
            kind,
            prompt,
            count: kind === "reminder" ? 1 : count,
          },
        });
        if (serial !== sequence.current) return;
        accept(generated.request_id, generated.draft, source);
        if (generated.usage_warning) setNotice(generated.usage_warning);
        feedback.action({ kind: "draft", subject: sourceSubject });
      }
    } catch (e) {
      if (serial === sequence.current) {
        setError(message(e));
        feedback.action({ kind: "error" });
      }
    } finally {
      if (serial === sequence.current) {
        setBusy(false);
        activeRequest.current = null;
      }
    }
  }
  async function save() {
    if (!working || saveLock.current) return;
    saveLock.current = true;
    setBusy(true);
    setError("");
    try {
      const base = { vaultRoot: snapshot.root, requestId: working.id };
      let connected: { node: string; targets: string[] } | undefined;
      if (working.draft.kind === "quiz")
        await invoke("save_study_quiz", {
          ...base,
          subjectId: destinationSubject,
          draft: working.draft.data,
        });
      else if (working.draft.kind === "flashcards") {
        const result = await invoke<{ snapshot: Snapshot; note_id: string }>(
          "save_study_flashcards",
          {
            ...base,
            draft: {
              ...working.draft.data,
              cards: working.draft.data.cards.filter((_, i) =>
                selectedCards.has(i),
              ),
            },
            destination: {
              subject_id: destinationSubject,
              note_id: destinationNote || null,
              new_path: newPath,
              revision: destinationRevision,
            },
          },
        );
        onSnapshot(result.snapshot);
        connected = {
          node: result.note_id,
          targets: result.snapshot.edges
            .filter(
              (e) => e.source === result.note_id || e.target === result.note_id,
            )
            .map((e) => (e.source === result.note_id ? e.target : e.source)),
        };
      } else
        await invoke("save_study_reminder", {
          ...base,
          draft: working.draft.data,
        });
      await onRefresh();
      void invoke("cancel_study", { requestId: working.id });
      feedback.action({ kind: "draft", subject: destinationSubject });
      if (connected?.targets.length)
        feedback.action({
          kind: "connect",
          ...connected,
          subject: destinationSubject,
        });
      setWorking(undefined);
      setNotice(
        working.draft.kind === "flashcards"
          ? "Flashcards saved without changing review history"
          : "Saved locally",
      );
      setScreen("library");
      setLibraryTab(
        working.draft.kind === "reminder" ? "reminders" : "quizzes",
      );
    } catch (e) {
      setError(message(e));
      feedback.action({ kind: "error" });
    } finally {
      saveLock.current = false;
      setBusy(false);
    }
  }
  async function reminderAction(
    reminder: Reminder,
    action: "cancel" | "dismiss" | "snooze",
  ) {
    if (busy || !view?.revision) return;
    setBusy(true);
    setError("");
    try {
      await invoke("act_on_reminder", {
        vaultRoot: snapshot.root,
        id: reminder.id,
        action,
        minutes: 10,
        revision: view.revision,
      });
      await onRefresh();
    } catch (e) {
      setError(message(e));
      await onRefresh();
    } finally {
      setBusy(false);
    }
  }
  async function saveReminderEdit() {
    if (!editingReminder || busy) return;
    setBusy(true);
    setError("");
    try {
      await invoke("edit_study_reminder", {
        vaultRoot: snapshot.root,
        ...editingReminder,
      });
      setEditingReminder(undefined);
      await onRefresh();
      setNotice("Reminder updated");
    } catch (e) {
      setError(message(e));
      await onRefresh();
    } finally {
      setBusy(false);
    }
  }
  const subjectOptions = snapshot.organization.subjects.map((s) => (
    <option key={s.id} value={s.id}>
      {snapshot.organization.neurons.find((n) => n.id === s.neuron_id)?.name} /{" "}
      {s.name}
    </option>
  ));
  const filteredQuizzes =
    view?.data.quizzes.filter((q) =>
      !scope.subject_id
        ? q.sources.some((s) => scopedNotes.some((n) => n.id === s.id)) ||
          !scope.neuron_id
        : q.subject_id === scope.subject_id,
    ) ?? [];
  const filteredReminders =
    view?.data.reminders.filter(
      (r) =>
        (!scope.subject_id || r.draft.subject_id === scope.subject_id) &&
        (!scope.neuron_id ||
          snapshot.organization.subjects.some(
            (s) =>
              s.id === r.draft.subject_id && s.neuron_id === scope.neuron_id,
          )),
    ) ?? [];
  return (
    <aside
      className="study-panel"
      aria-label={
        screen === "create" ? "Create study material" : "Study library"
      }
    >
      <header className="study-header">
        <h2>
          {playing
            ? "Quiz"
            : editingReminder
              ? "Edit reminder"
              : screen === "create"
                ? "Create study material"
                : "Study library"}
        </h2>
        <button aria-label="Close study drawer" onClick={close}>
          <X size={20} />
        </button>
      </header>
      {!playing && !editingReminder && (
        <nav
          className="study-tabs"
          aria-label={
            screen === "create" ? "Study material type" : "Saved study type"
          }
          role="tablist"
        >
          {(screen === "create"
            ? ["quiz", "flashcards", "reminder"]
            : ["quizzes", "reminders"]
          ).map((tab, index, tabs) => (
            <button
              key={tab}
              role="tab"
              aria-selected={
                screen === "create" ? kind === tab : libraryTab === tab
              }
              disabled={busy || !!working}
              tabIndex={
                (screen === "create" ? kind === tab : libraryTab === tab)
                  ? 0
                  : -1
              }
              onKeyDown={(e) => {
                if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                e.preventDefault();
                const next =
                  tabs[
                    (index + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) %
                      tabs.length
                  ];
                if (screen === "create") setKind(next as StudyKind);
                else setLibraryTab(next as "quizzes" | "reminders");
                (
                  e.currentTarget.parentElement?.children[
                    tabs.indexOf(next)
                  ] as HTMLElement
                )?.focus();
              }}
              onClick={() => {
                setError("");
                if (screen === "create") setKind(tab as StudyKind);
                else setLibraryTab(tab as "quizzes" | "reminders");
              }}
            >
              {tab[0].toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </nav>
      )}
      <div className="study-scroll">
        {settings?.test_api && (
          <p className="draft-caution">Local API mock · Desktop verification</p>
        )}
        {closing && (
          <div className="draft-discard" role="alert">
            <p>Discard this unsaved draft?</p>
            <div className="button-row">
              <button onClick={() => setClosing(false)}>Keep editing</button>
              <button
                onClick={() => {
                  discard();
                  setEditingReminder(undefined);
                  if (pendingScreen.current) {
                    setScreen(pendingScreen.current);
                    pendingScreen.current = null;
                  } else onClose();
                }}
              >
                {pendingScreen.current
                  ? "Discard and continue"
                  : "Discard and close"}
              </button>
            </div>
          </div>
        )}
        {(error || loadError) && (
          <div className="form-error" role="alert">
            {error || loadError}
            <button onClick={() => void onRefresh()}>Refresh study data</button>
          </div>
        )}
        {notice && (
          <p className="study-notice" role="status">
            <Check size={15} />
            {notice}
          </p>
        )}
        {playing ? (
          <QuizPlayer
            key={`${playing.quiz.id}:${playing.attempt?.id ?? "new"}`}
            root={snapshot.root}
            quiz={playing.quiz}
            previous={playing.attempt}
            onBack={() => setPlaying(undefined)}
            onOpen={onOpen}
            onSaved={() => void onRefresh()}
          />
        ) : editingReminder ? (
          <>
            <button onClick={() => setEditingReminder(undefined)}>
              <ArrowLeft size={15} />
              Back to reminders
            </button>
            <ReminderEditor
              draft={editingReminder.draft}
              snapshot={snapshot}
              onChange={(draft) =>
                setEditingReminder({ ...editingReminder, draft })
              }
              onValidity={setReminderValid}
            />
            <button
              className="primary"
              disabled={busy || !reminderValid}
              onClick={() => void saveReminderEdit()}
            >
              Save reminder changes
            </button>
          </>
        ) : screen === "library" ? (
          <>
            <button
              className="create-study-link"
              onClick={() => {
                setScreen("create");
                setKind(libraryTab === "quizzes" ? "quiz" : "reminder");
                setNotice("");
              }}
            >
              <Plus size={16} />
              Create {libraryTab === "quizzes" ? "a quiz" : "a reminder"}
            </button>
            {libraryTab === "quizzes" ? (
              <>
                {filteredQuizzes.length === 0 && (
                  <p className="empty-study">No saved quizzes in this scope</p>
                )}
                {filteredQuizzes.map((quiz) => {
                  const attempts =
                    view?.data.attempts.filter((a) => a.quiz_id === quiz.id) ??
                    [];
                  return (
                    <section className="saved-study-row" key={quiz.id}>
                      <h3>{quiz.draft.title}</h3>
                      <p className="muted">
                        {quiz.draft.questions.length} questions ·{" "}
                        {attempts.length} attempts
                      </p>
                      <div className="button-row">
                        <button
                          className="primary"
                          onClick={() => setPlaying({ quiz })}
                        >
                          Take quiz
                        </button>
                        {attempts.length > 0 && (
                          <button
                            onClick={() =>
                              setPlaying({ quiz, attempt: attempts.at(-1) })
                            }
                          >
                            Last result
                          </button>
                        )}
                      </div>
                    </section>
                  );
                })}
              </>
            ) : (
              <>
                {filteredReminders.some((r) => r.pending_due !== null) && (
                  <p className="catch-up" role="status">
                    Reminders are ready. Review them here without replaying
                    missed notifications.
                  </p>
                )}
                {filteredReminders.length === 0 && (
                  <p className="empty-study">
                    No saved reminders in this scope
                  </p>
                )}
                {[...filteredReminders]
                  .sort(
                    (a, b) =>
                      Number(b.pending_due !== null) -
                        Number(a.pending_due !== null) ||
                      (a.next_due ?? Infinity) - (b.next_due ?? Infinity),
                  )
                  .map((r) => (
                    <section
                      className={`saved-study-row ${r.pending_due !== null ? "reminder-ready" : ""}`}
                      key={r.id}
                    >
                      <h3>{r.draft.title}</h3>
                      <p>
                        {r.pending_due !== null
                          ? "Ready"
                          : r.enabled && r.next_due
                            ? new Intl.DateTimeFormat(undefined, {
                                dateStyle: "medium",
                                timeStyle: "short",
                                timeZone: r.draft.timezone,
                              }).format(r.next_due * 1000)
                            : "Paused or complete"}
                        <span className="muted">
                          {" "}
                          · {r.draft.timezone}
                          {r.draft.repetition !== "none"
                            ? ` · ${r.draft.repetition}`
                            : ""}
                        </span>
                      </p>
                      {r.draft.source_id && (
                        <button
                          className="source-link"
                          onClick={() => onOpen(r.draft.source_id!)}
                        >
                          <FileText size={14} />
                          {snapshot.notes.find(
                            (n) => n.id === r.draft.source_id,
                          )?.title ?? r.draft.source_id}
                        </button>
                      )}
                      <div className="button-row">
                        {r.pending_due !== null && (
                          <>
                            <button
                              disabled={busy}
                              onClick={() => void reminderAction(r, "dismiss")}
                            >
                              Dismiss
                            </button>
                            <button
                              disabled={busy}
                              onClick={() => void reminderAction(r, "snooze")}
                            >
                              Snooze 10 min
                            </button>
                          </>
                        )}
                        <button
                          disabled={busy}
                          onClick={() =>
                            setEditingReminder({
                              id: r.id,
                              draft: r.draft,
                              revision: view!.revision!,
                            })
                          }
                        >
                          Edit
                        </button>
                        {r.enabled && (
                          <button
                            disabled={busy}
                            onClick={() => void reminderAction(r, "cancel")}
                          >
                            Cancel reminder
                          </button>
                        )}
                      </div>
                    </section>
                  ))}
              </>
            )}
          </>
        ) : working ? (
          <>
            <p className="draft-caution">
              Editable draft · Check accuracy before saving
            </p>
            {working.draft.kind === "quiz" ? (
              <QuizEditor
                draft={working.draft.data}
                sources={working.context.sources}
                onChange={(data) =>
                  setWorking({ ...working, draft: { kind: "quiz", data } })
                }
              />
            ) : working.draft.kind === "flashcards" ? (
              <FlashcardEditor
                draft={working.draft.data}
                sources={working.context.sources}
                selected={selectedCards}
                onSelected={setSelectedCards}
                onChange={(data) =>
                  setWorking({
                    ...working,
                    draft: { kind: "flashcards", data },
                  })
                }
              />
            ) : (
              <ReminderEditor
                draft={working.draft.data}
                snapshot={snapshot}
                onChange={(data) =>
                  setWorking({ ...working, draft: { kind: "reminder", data } })
                }
                onValidity={setReminderValid}
              />
            )}
            {working.draft.kind !== "reminder" && (
              <section className="study-destination">
                <label>
                  Save in subject
                  <select
                    aria-label="Study destination subject"
                    value={destinationSubject}
                    onChange={(e) => {
                      setDestinationSubject(e.target.value);
                      setDestinationNote("");
                      setDestinationRevision(null);
                    }}
                  >
                    {subjectOptions}
                  </select>
                </label>
                {working.draft.kind === "flashcards" && (
                  <>
                    <label>
                      Destination note
                      <select
                        aria-label="Flashcard destination note"
                        value={destinationNote}
                        onChange={(e) => {
                          setDestinationNote(e.target.value);
                          setDestinationRevision(
                            snapshot.notes.find((n) => n.id === e.target.value)
                              ?.revision ?? null,
                          );
                        }}
                      >
                        <option value="">Create a new note</option>
                        {snapshot.notes
                          .filter(
                            (n) =>
                              n.subject_id === destinationSubject &&
                              !working.context.sources.some(
                                (s) => s.id === n.id,
                              ),
                          )
                          .map((n) => (
                            <option value={n.id} key={n.id}>
                              {n.title}
                            </option>
                          ))}
                      </select>
                    </label>
                    {!destinationNote ? (
                      <label>
                        New note path
                        <input
                          aria-label="Flashcard new note path"
                          value={newPath}
                          onChange={(e) => setNewPath(e.target.value)}
                        />
                      </label>
                    ) : (
                      <p>
                        Cards are appended to this note.{" "}
                        <button
                          onClick={() => {
                            setDestinationRevision(
                              snapshot.notes.find(
                                (n) => n.id === destinationNote,
                              )?.revision ?? null,
                            );
                            setNotice("Destination revision refreshed");
                          }}
                        >
                          Reload destination revision
                        </button>
                      </p>
                    )}
                    <p className="muted">
                      Source notes are protected. Saving creates no review
                      history.
                    </p>
                  </>
                )}
              </section>
            )}
          </>
        ) : (
          <>
            <div className="study-source-controls">
              <label>
                Sources
                <select
                  aria-label="Study sources"
                  value={sourceMode}
                  disabled={busy}
                  onChange={(e) => setSourceMode(e.target.value)}
                >
                  {currentNote && <option value="note">Current note</option>}
                  <option value="subject">Subject</option>
                  <option value="selected">Selected notes</option>
                </select>
              </label>
              {sourceMode === "subject" && (
                <label>
                  Subject
                  <select
                    aria-label="Source subject"
                    value={sourceSubject}
                    disabled={busy}
                    onChange={(e) => {
                      setSourceSubject(e.target.value);
                      setDestinationSubject(e.target.value);
                    }}
                  >
                    {snapshot.organization.subjects
                      .filter(
                        (s) =>
                          (!scope.neuron_id ||
                            s.neuron_id === scope.neuron_id) &&
                          (!scope.subject_id || s.id === scope.subject_id),
                      )
                      .map((s) => (
                        <option value={s.id} key={s.id}>
                          {
                            snapshot.organization.neurons.find(
                              (n) => n.id === s.neuron_id,
                            )?.name
                          }{" "}
                          / {s.name}
                        </option>
                      ))}
                  </select>
                </label>
              )}
            </div>
            {sourceMode === "selected" && (
              <fieldset className="note-picker">
                <legend>Select up to 20 notes</legend>
                {scopedNotes.map((n) => (
                  <label className="check-option" key={n.id}>
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={chosen.includes(n.id)}
                      onChange={(e) =>
                        setChosen(
                          e.target.checked
                            ? [...chosen, n.id]
                            : chosen.filter((id) => id !== n.id),
                        )
                      }
                    />
                    {n.title}
                  </label>
                ))}
              </fieldset>
            )}
            {contextError && (
              <p className="form-error" role="alert">
                {contextError}
              </p>
            )}
            {context && (
              <details className="context-preview">
                <summary>
                  {context.sources.length} source notes ·{" "}
                  {context.bytes.toLocaleString()} bytes
                  {kind === "reminder" ? " · titles only" : ""}
                </summary>
                <p>
                  Only this selected text and your request are sent. Attachments
                  and other vault content are excluded.
                </p>
                {context.sources.map((s) => (
                  <details key={s.id}>
                    <summary>{s.title}</summary>
                    <div className="source-preview-text">
                      {s.content || "Title and source reference only"}
                    </div>
                  </details>
                ))}
              </details>
            )}
            {context?.excluded.map((x) => (
              <p className="form-error" key={x.id}>
                {x.id}: {x.reason}
              </p>
            ))}
            <label className="study-prompt">
              {kind === "reminder"
                ? "Reminder request"
                : "What would you like to study?"}
              <textarea
                aria-label="Study request"
                maxLength={2000}
                rows={3}
                value={prompt}
                disabled={busy}
                placeholder={
                  kind === "reminder"
                    ? "Remind me to revise momentum tomorrow at 6 pm"
                    : "Focus on the ideas I need to explain and apply"
                }
                onChange={(e) => setPrompt(e.target.value)}
              />
            </label>
            <div className="generate-row">
              {kind !== "reminder" && (
                <label>
                  Items
                  <select
                    aria-label="Number of study items"
                    disabled={busy}
                    value={count}
                    onChange={(e) => setCount(Number(e.target.value))}
                  >
                    {[3, 5, 10, 15, 20].map((n) => (
                      <option key={n} value={n}>
                        {n} {kind === "quiz" ? "questions" : "cards"}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {busy ? (
                <button onClick={cancel}>Cancel generation</button>
              ) : (
                <button
                  className="primary"
                  disabled={
                    !context ||
                    !prompt.trim() ||
                    (kind !== "reminder" && !context.sources.length)
                  }
                  onClick={() => void start(false)}
                >
                  Generate {kind === "flashcards" ? "flashcards" : kind}
                </button>
              )}
            </div>
            {busy && (
              <p className="generating" role="status">
                <LoaderCircle className="spin" size={16} />
                Generating draft
              </p>
            )}
            {settings?.test_api && (
              <p className="form-notice">
                Mock API — local deterministic test responses
              </p>
            )}
            {!settings?.key_present && !settings?.test_api && (
              <p className="muted">
                Add an API key in{" "}
                <button className="inline-button" onClick={onSettings}>
                  Settings
                </button>
                , or create a draft manually.
              </p>
            )}
            <button
              className="manual-study"
              disabled={
                busy ||
                !context ||
                (kind !== "reminder" && !context.sources.length)
              }
              onClick={() => void start(true)}
            >
              Start {kind === "reminder" ? "a manual reminder" : "manually"}
            </button>
            <p className="muted">
              Generated study material can be inaccurate and is not an official
              examination.
            </p>
            <button
              className="saved-study-link"
              onClick={() => {
                setScreen("library");
                setLibraryTab(kind === "reminder" ? "reminders" : "quizzes");
              }}
            >
              Open saved study material
            </button>
          </>
        )}
      </div>
      {working && screen === "create" && (
        <footer className="study-footer">
          <button disabled={busy} onClick={discard}>
            Discard draft
          </button>
          <button
            className="primary"
            disabled={
              busy ||
              (working.draft.kind === "reminder" && !reminderValid) ||
              (working.draft.kind === "flashcards" && selectedCards.size === 0)
            }
            onClick={() => void save()}
          >
            Save{" "}
            {working.draft.kind === "flashcards"
              ? `${selectedCards.size} flashcards`
              : working.draft.kind}
          </button>
        </footer>
      )}
    </aside>
  );
}
