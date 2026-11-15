import { useEffect, useState } from "react";
import { ArrowUpRight, Check, RotateCcw, X } from "lucide-react";
import type { Rating, Snapshot } from "../types";
import { inLocation } from "../types";
import Markdown from "./Markdown";
import { feedback } from "../interaction/events";
import { formatInterval, useRatingPreviews } from "../hooks/useRatingPreviews";
export default function Review({
  snapshot,
  onRate,
  onClose,
  onSource,
  onWiki,
}: {
  snapshot: Snapshot;
  onRate: (id: string, rating: Rating) => Promise<boolean>;
  onClose: () => void;
  onSource: (id: string) => void;
  onWiki: (raw: string, source: string) => void;
}) {
  const [subject, setSubject] = useState("all"),
    [revealedId, setRevealedId] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(0),
    [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(timer);
  }, []);
  const cards = snapshot.cards.filter(
    (c) =>
      inLocation(c, snapshot.organization.location) &&
      (subject === "all" || c.subject_id === subject),
  );
  const due = cards
    .filter(
      (c) =>
        !snapshot.history.cards[c.id] ||
        snapshot.history.cards[c.id].due <= now,
    )
    .sort(
      (a, b) =>
        (snapshot.history.cards[a.id]?.due ?? 0) -
        (snapshot.history.cards[b.id]?.due ?? 0),
    );
  const card = due[0],
    fresh = due.filter((c) => !snapshot.history.cards[c.id]).length;
  const revealed = !!card && revealedId === card.id;
  const previews = useRatingPreviews(snapshot, card?.id);
  const retry = cards
    .filter(
      (c) =>
        snapshot.history.cards[c.id]?.due > now &&
        snapshot.history.cards[c.id]?.due <= now + 60,
    )
    .sort(
      (a, b) =>
        snapshot.history.cards[a.id].due - snapshot.history.cards[b.id].due,
    )[0];
  async function rate(rating: Rating) {
    if (!card || !revealed || !previews.data || busy) return;
    setBusy(true);
    try {
      if (await onRate(card.id, rating)) {
        if (rating !== "again" && due.length === 1 && !retry)
          feedback.action({ kind: "complete", subject: card.subject_id });
        setRevealedId(null);
        setDone((n) => n + 1);
        setNow(Date.now() / 1000);
      }
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement).closest(
          'input,textarea,select,[contenteditable="true"]',
        )
      )
        return;
      if (e.code === "Space" && card && !busy) {
        e.preventDefault();
        setRevealedId(card?.id ?? null);
      }
      if (revealed && ["1", "2", "3", "4"].includes(e.key)) {
        e.preventDefault();
        void rate(
          (["again", "hard", "good", "easy"] as Rating[])[Number(e.key) - 1],
        );
      }
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  });
  return (
    <div className="overlay">
      <section
        className="review-dialog glass"
        role="dialog"
        aria-modal="true"
        aria-label="Flashcard revision"
      >
        <header>
          <div>
            <h2>Review</h2>
          </div>
          <button
            title="Close review"
            aria-label="Close review"
            disabled={busy}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        <div className="review-meta">
          <select
            aria-label="Review subject"
            value={subject}
            onChange={(e) => {
              setSubject(e.target.value);
              setRevealedId(null);
            }}
          >
            <option value="all">Selected location</option>
            {snapshot.organization.subjects
              .filter(
                (s) =>
                  !snapshot.organization.location.neuron_id ||
                  s.neuron_id === snapshot.organization.location.neuron_id,
              )
              .filter(
                (s) =>
                  !snapshot.organization.location.subject_id ||
                  s.id === snapshot.organization.location.subject_id,
              )
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {!snapshot.organization.location.neuron_id
                    ? ` — ${snapshot.organization.neurons.find((n) => n.id === s.neuron_id)?.name}`
                    : ""}
                </option>
              ))}
          </select>
          <span>
            {due.length - fresh} due · {fresh} new · {done} reviewed
          </span>
        </div>
        {snapshot.review_error ? (
          <div className="error selectable">{snapshot.review_error}</div>
        ) : card ? (
          <>
            <div className="review-content" key={card.id}>
              <Markdown
                text={card.question}
                onWiki={(raw) => onWiki(raw, card.source)}
              />
              {revealed && (
                <div className="answer">
                  <Markdown
                    text={card.answer}
                    onWiki={(raw) => onWiki(raw, card.source)}
                  />
                </div>
              )}
            </div>
            <button
              className="source-link"
              onClick={() => onSource(card.source)}
            >
              {snapshot.notes.find((n) => n.id === card.source)?.title ??
                "Open source note"}
              <ArrowUpRight size={13} />
            </button>
            <footer>
              {previews.error && (
                <div className="interval-error" role="alert">
                  <span>{previews.error}</span>
                  <button onClick={previews.retry} disabled={busy}>
                    Retry intervals
                  </button>
                </div>
              )}
              {!revealed ? (
                <button
                  className="primary reveal"
                  onClick={() => setRevealedId(card?.id ?? null)}
                >
                  Reveal answer <kbd>Space</kbd>
                </button>
              ) : (
                <div className="ratings">
                  {(["again", "hard", "good", "easy"] as Rating[]).map(
                    (r, i) => (
                      <button
                        className="raised"
                        disabled={busy || !previews.data}
                        key={r}
                        onClick={() => void rate(r)}
                      >
                        <span>
                          {r[0].toUpperCase() + r.slice(1)} <kbd>{i + 1}</kbd>
                        </span>
                        <small>
                          {previews.data
                            ? formatInterval(
                                previews.data.options.find(
                                  (option) => option.rating === r,
                                )!.interval_seconds,
                              )
                            : "…"}
                        </small>
                      </button>
                    ),
                  )}
                </div>
              )}
            </footer>
          </>
        ) : (
          <div className="review-complete">
            {retry ? <RotateCcw size={28} /> : <Check size={30} />}
            <h2>
              {retry
                ? "Retry shortly"
                : cards.length
                  ? "Reviews complete"
                  : "No cards in this location"}
            </h2>
            <p>
              {retry
                ? `Your next retry appears in ${Math.ceil(snapshot.history.cards[retry.id].due - now)} seconds.`
                : cards.length
                  ? "Your next reviews will appear when they’re due."
                  : "Add Q: / A: pairs or Term :: Definition to your notes."}
            </p>
            <button className="primary" onClick={onClose}>
              Close review
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
