import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Answer, Attempt, Quiz, StudyView } from "../study";
import { message } from "../types";
import Markdown from "./Markdown";
import { feedback } from "../interaction/events";
export default function QuizPlayer({
  quiz,
  root,
  previous,
  onBack,
  onOpen,
  onSaved,
}: {
  quiz: Quiz;
  root: string;
  previous?: Attempt;
  onBack: () => void;
  onOpen: (id: string) => void;
  onSaved: () => void;
}) {
  const [index, setIndex] = useState(0),
    [answers, setAnswers] = useState<Answer[]>(() =>
      quiz.draft.questions.map((q) => ({
        question_id: q.id,
        option: null,
        response: "",
        self_assessed: null,
      })),
    ),
    [guidance, setGuidance] = useState(false),
    [result, setResult] = useState(previous),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const attemptId = useRef(crypto.randomUUID()),
    saving = useRef(false);
  const q = quiz.draft.questions[index],
    answer = answers[index];
  const update = (patch: Partial<Answer>) =>
    setAnswers(answers.map((a, i) => (i === index ? { ...a, ...patch } : a)));
  const wiki = (raw: string) => {
    const source = quiz.sources.find(
      (s) => s.id.replace(/\.md$/i, "") === raw.replace(/^\.\//, ""),
    );
    if (source && !source.external) onOpen(source.id);
  };
  async function finish() {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      const view = await invoke<StudyView>("save_quiz_attempt", {
        vaultRoot: root,
        quizId: quiz.id,
        attemptId: attemptId.current,
        answers,
      });
      setResult(view.data.attempts.find((a) => a.id === attemptId.current));
      feedback.action({
        kind: "complete",
        subject: quiz.subject_id,
        node: quiz.sources.find((s) => !s.external)?.id,
      });
      onSaved();
    } catch (e) {
      setError(message(e));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="quiz-player">
      <button onClick={onBack}>Back to saved quizzes</button>
      <h2>{quiz.draft.title}</h2>
      {result ? (
        <>
          <p className="quiz-score">
            {result.correct} / {result.total}
          </p>
          <p>
            Multiple-choice answers are marked locally. Short answers use your
            self-assessment. Review history is unchanged.
          </p>
          {quiz.draft.questions.map((question) => {
            const a = result.answers.find(
              (a) => a.question_id === question.id,
            )!;
            return (
              <section className="quiz-result" key={question.id}>
                <Markdown text={question.prompt} onWiki={wiki} />
                <p className="muted">
                  {question.kind === "multiple_choice"
                    ? a.option === question.correct_index
                      ? "Correct"
                      : "Needs revision"
                    : a.self_assessed
                      ? "Self-assessed: understood"
                      : "Self-assessed: needs revision"}
                </p>
                {question.kind === "multiple_choice" ? (
                  <p>
                    {a.option !== null
                      ? question.options[a.option]
                      : "No answer"}
                  </p>
                ) : (
                  <p>{a.response || "No written answer"}</p>
                )}
                <Markdown text={question.answer} onWiki={wiki} />
                <Markdown text={question.explanation} onWiki={wiki} />
                {question.sources.map((id) => (
                  <button
                    className="source-link"
                    key={id}
                    onClick={() => onOpen(id)}
                    disabled={quiz.sources.find((s) => s.id === id)?.external}
                  >
                    {quiz.sources.find((s) => s.id === id)?.title ?? id}
                  </button>
                ))}
              </section>
            );
          })}
        </>
      ) : (
        <>
          <p className="muted">
            Question {index + 1} of {quiz.draft.questions.length}
          </p>
          <Markdown text={q.prompt} onWiki={wiki} />
          {q.kind === "multiple_choice" ? (
            <fieldset className="quiz-answer-options">
              <legend className="sr-only">Choose an answer</legend>
              {q.options.map((option, i) => (
                <label key={i}>
                  <input
                    type="radio"
                    name={`answer-${q.id}`}
                    checked={answer.option === i}
                    onChange={() => update({ option: i })}
                  />
                  <Markdown text={option} onWiki={wiki} />
                </label>
              ))}
            </fieldset>
          ) : (
            <>
              <label>
                Your answer
                <textarea
                  rows={5}
                  value={answer.response}
                  maxLength={8000}
                  onChange={(e) =>
                    update({ response: e.target.value, self_assessed: null })
                  }
                />
              </label>
              <button onClick={() => setGuidance(true)}>
                Show marking guidance
              </button>
              {guidance && (
                <div className="marking-guidance">
                  <Markdown text={q.answer} onWiki={wiki} />
                  <Markdown text={q.explanation} onWiki={wiki} />
                  <p>Assess your answer locally</p>
                  <div className="button-row">
                    <button
                      aria-pressed={answer.self_assessed === true}
                      onClick={() => update({ self_assessed: true })}
                    >
                      Understood
                    </button>
                    <button
                      aria-pressed={answer.self_assessed === false}
                      onClick={() => update({ self_assessed: false })}
                    >
                      Needs revision
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
          <div className="quiz-navigation">
            <button
              disabled={index === 0 || busy}
              onClick={() => {
                setIndex(index - 1);
                setGuidance(false);
              }}
            >
              Previous
            </button>
            <button
              className="primary"
              disabled={
                busy ||
                (q.kind === "multiple_choice"
                  ? answer.option === null
                  : answer.self_assessed === null)
              }
              onClick={() => {
                if (index === quiz.draft.questions.length - 1) void finish();
                else {
                  setIndex(index + 1);
                  setGuidance(false);
                }
              }}
            >
              {index === quiz.draft.questions.length - 1
                ? "Finish quiz"
                : "Next question"}
            </button>
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </div>
  );
}
