import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  AlertTriangle,
  FolderOpen,
  Waypoints,
  Settings2,
  LoaderCircle,
  X,
} from "lucide-react";
import { useWorkspace } from "./hooks/useWorkspace";
import { useModalFocus } from "./hooks/useModalFocus";
import Graph from "./components/Graph";
import Review from "./components/Review";
import Sidebar, { type Action } from "./components/Sidebar";
import EditorPanel from "./components/EditorPanel";
import OrganizationDialog from "./components/OrganizationDialog";
import Preferences from "./components/Preferences";
import { feedback } from "./interaction/events";
import StudyPanel from "./components/StudyPanel";
import { useStudy } from "./hooks/useStudy";
import { useReducedMotion } from "./hooks/useReducedMotion";
export default function App() {
  const w = useWorkspace();
  const reduced = useReducedMotion();
  const { vault, doc, busy, create, pending, linkChoice } = w;
  const drawer = useRef<HTMLDivElement>(null),
    retained = useRef(w);
  if (doc) retained.current = w;
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [studyPanel, setStudyPanel] = useState<{
    origin: string;
    view: "create" | "library";
  } | null>(null);
  const studyOrigin = JSON.stringify([
    vault?.root,
    vault?.organization.location,
    doc?.id,
  ]);
  const studyOpen = studyPanel?.origin === studyOrigin;
  const study = useStudy(vault?.root);
  useEffect(() => feedback.attach(), []);
  useEffect(() => {
    feedback.cancel();
  }, [vault?.root]);
  useEffect(() => {
    if (!isTauri()) return;
    let alive = true,
      notified = false;
    const unlisten = getCurrentWindow().onFocusChanged(({ payload }) => {
      notified = true;
      if (alive) feedback.setNativeFocus(payload);
    });
    void getCurrentWindow()
      .isFocused()
      .then((focused) => {
        if (alive && !notified) feedback.setNativeFocus(focused);
      });
    return () => {
      alive = false;
      void unlisten.then((fn) => fn());
    };
  }, []);
  const [action, setAction] = useState<Action | null>(null),
    [noteSubject, setNoteSubject] = useState(""),
    [width, setWidth] = useState(window.innerWidth);
  useEffect(() => {
    const resize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const modal = preferencesOpen
    ? "preferences"
    : linkChoice
      ? "link"
      : pending
        ? "unsaved"
        : create !== null
          ? "note"
          : action
            ? `organization-${action.kind}`
            : w.review
              ? "review"
              : "";
  useModalFocus(modal);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || busy || action || w.review || preferencesOpen)
        return;
      if (linkChoice) w.setLinkChoice(null);
      else if (pending) w.setPending(null);
      else if (create !== null) w.setCreate(null);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  function newNote(subject?: string) {
    w.guard("Create a note?", () => {
      setNoteSubject(
        subject ??
          vault?.organization.location.subject_id ??
          vault?.organization.subjects.find(
            (s) => s.neuron_id === vault.organization.location.neuron_id,
          )?.id ??
          vault?.organization.fallback_subject ??
          "",
      );
      w.setCreate("");
      w.setCreateAtRoot(false);
    });
  }
  function showAction(a: Action) {
    w.guard("Continue with unsaved edits?", () => {
      w.setReview(false);
      setAction(a);
    });
  }
  const left = w.collapsed ? 88 : 312;
  const editorWidth = Math.max(
    320,
    Math.min(studyOpen ? 560 : w.panelWidth, width - left - 180),
  );
  return (
    <main className="app" data-motion={reduced ? "reduced" : "full"}>
      {!vault ? (
        <div className="welcome">
          <Waypoints size={34} strokeWidth={1.5} />
          <h1>Synapse</h1>
          <button
            className="primary"
            disabled={busy}
            onClick={() => void w.chooseVault()}
          >
            {busy ? (
              <LoaderCircle className="spin" size={18} />
            ) : (
              <FolderOpen size={18} />
            )}
            Open vault
          </button>
          <p>Choose a folder of Markdown notes</p>
          <button onClick={() => setPreferencesOpen(true)}>
            <Settings2 size={16} />
            Preferences
          </button>
        </div>
      ) : (
        <>
          <Graph
            key={vault.root}
            snapshot={vault}
            selected={doc?.id}
            query={w.query}
            left={left}
            drawer={drawer}
            editorWidth={editorWidth}
            auxiliaryOpen={studyOpen}
            onOpen={w.openNote}
            onNewNote={() => newNote()}
          />
          <Sidebar
            w={w}
            onAction={showAction}
            onNewNote={newNote}
            onPreferences={() => setPreferencesOpen(true)}
            onStudy={(view) =>
              w.guard("Open study tools?", () => {
                w.setReview(false);
                if (studyOpen)
                  window.dispatchEvent(
                    new CustomEvent("synapse-study-screen", { detail: view }),
                  );
                else setStudyPanel({ origin: studyOrigin, view });
              })
            }
            remindersReady={
              study.view?.data.reminders.filter((r) => r.pending_due !== null)
                .length ?? 0
            }
          />
          {(studyOpen ||
            (retained.current.doc &&
              retained.current.vault?.root === vault.root)) && (
            <div
              ref={drawer}
              inert={!doc && !studyOpen}
              aria-hidden={!doc && !studyOpen}
              className="editor-shell glass"
              style={{ width: editorWidth }}
            >
              {!studyOpen && (
                <div
                  className="resize-handle"
                  role="separator"
                  tabIndex={0}
                  aria-label="Resize editor"
                  aria-orientation="vertical"
                  aria-valuemin={320}
                  aria-valuemax={Math.max(320, width - left - 250)}
                  aria-valuenow={editorWidth}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowLeft") {
                      e.preventDefault();
                      w.setPanelWidth(
                        Math.min(width - left - 250, editorWidth + 24),
                      );
                    }
                    if (e.key === "ArrowRight") {
                      e.preventDefault();
                      w.setPanelWidth(Math.max(320, editorWidth - 24));
                    }
                  }}
                  onPointerDown={(e) =>
                    e.currentTarget.setPointerCapture(e.pointerId)
                  }
                  onPointerMove={(e) => {
                    if (e.currentTarget.hasPointerCapture(e.pointerId))
                      w.setPanelWidth(
                        Math.max(
                          320,
                          Math.min(width - left - 250, width - e.clientX - 16),
                        ),
                      );
                  }}
                />
              )}
              {studyOpen ? (
                <StudyPanel
                  key={studyOrigin}
                  snapshot={vault}
                  currentNote={doc?.id}
                  initialView={studyPanel.view}
                  view={study.view}
                  loadError={study.error}
                  onRefresh={study.refresh}
                  onSnapshot={w.setVault}
                  onOpen={(id) => {
                    setStudyPanel(null);
                    w.openNote(id);
                  }}
                  onClose={() => setStudyPanel(null)}
                  onSettings={() => setPreferencesOpen(true)}
                />
              ) : (
                <EditorPanel
                  {...(doc ? w : retained.current)}
                  panelWidth={editorWidth}
                />
              )}
            </div>
          )}
          {(w.status.startsWith("Imported ") ||
            w.status === "Subject exported") &&
            !doc && (
              <div className="completion-toast glass" role="status">
                {w.status}
                <button
                  aria-label="Dismiss status"
                  onClick={() => w.setStatus("All changes saved")}
                >
                  <X size={15} />
                </button>
              </div>
            )}
        </>
      )}
      {preferencesOpen && (
        <Preferences onClose={() => setPreferencesOpen(false)} />
      )}
      {(w.error || !!vault?.warnings.length) && (
        <div className="notification glass" role="alert">
          <AlertTriangle size={18} />
          <div className="selectable">
            {w.error || vault?.warnings.join("\n")}
          </div>
          <button
            aria-label="Dismiss notification"
            onClick={() => {
              w.setError("");
              if (vault) w.setVault({ ...vault, warnings: [] });
            }}
          >
            <X size={17} />
          </button>
        </div>
      )}
      {w.review && vault && (
        <Review
          snapshot={vault}
          onRate={w.rate}
          onClose={() => w.setReview(false)}
          onSource={w.openNote}
          onWiki={w.wiki}
        />
      )}
      {action && vault && (
        <OrganizationDialog
          action={action}
          w={w}
          onClose={() => setAction(null)}
        />
      )}
      {create !== null && vault && (
        <div className="overlay">
          <form
            className="dialog glass"
            role="dialog"
            aria-modal="true"
            aria-label="New note"
            onSubmit={(e) => {
              e.preventDefault();
              void w.createNote(noteSubject);
            }}
          >
            <header>
              <h2>New note</h2>
              <button
                type="button"
                aria-label="Close dialog"
                disabled={busy}
                onClick={() => w.setCreate(null)}
              >
                <X size={18} />
              </button>
            </header>
            <label>
              Subject
              <select
                aria-label="Note subject"
                disabled={w.createAtRoot}
                value={noteSubject}
                onChange={(e) => setNoteSubject(e.target.value)}
              >
                {vault.organization.neurons.map((n) => (
                  <optgroup key={n.id} label={n.name}>
                    {vault.organization.subjects
                      .filter((s) => s.neuron_id === n.id)
                      .map((s) => (
                        <option value={s.id} key={s.id}>
                          {s.name}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label>
              {w.createAtRoot ? "Vault-relative note path" : "Note name"}
              <input
                autoFocus
                placeholder="Motion/Conservation of momentum"
                value={create}
                onChange={(e) => w.setCreate(e.target.value)}
              />
            </label>
            <p>Use / to create a subfolder</p>
            <footer>
              <button
                type="button"
                disabled={busy}
                onClick={() => w.setCreate(null)}
              >
                Cancel
              </button>
              <button
                className="primary"
                type="submit"
                disabled={busy || !create.trim()}
              >
                Create note
              </button>
            </footer>
          </form>
        </div>
      )}
      {pending && (
        <div className="overlay">
          <section
            className="dialog glass"
            role="alertdialog"
            aria-modal="true"
            aria-label={pending.title}
          >
            <h2>{pending.title}</h2>
            <p>{pending.detail}</p>
            <footer>
              <button disabled={busy} onClick={() => w.setPending(null)}>
                Cancel
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  const next = pending.action;
                  w.setPending(null);
                  next();
                }}
              >
                Discard edits
              </button>
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  void w.save().then((ok) => {
                    if (ok) {
                      const next = pending.action;
                      w.setPending(null);
                      next();
                    } else w.setPending(null);
                  })
                }
              >
                Save and continue
              </button>
            </footer>
          </section>
        </div>
      )}
      {linkChoice && (
        <div className="overlay">
          <section
            className="dialog glass"
            role="dialog"
            aria-modal="true"
            aria-label="Resolve WikiLink"
          >
            <header>
              <h2>
                {linkChoice.external
                  ? "External reference"
                  : linkChoice.ids.length
                    ? "Choose a note"
                    : "Note not found"}
              </h2>
              <button
                aria-label="Close dialog"
                onClick={() => w.setLinkChoice(null)}
              >
                <X size={18} />
              </button>
            </header>
            <p className="selectable">[[{linkChoice.raw}]]</p>
            {linkChoice.external && (
              <p>
                This reference points outside the imported subject. Edit its
                WikiLink to connect it to a note in this vault.
              </p>
            )}
            {linkChoice.ids.map((id) => (
              <button
                className="choice"
                key={id}
                onClick={() => {
                  w.setLinkChoice(null);
                  w.openNote(id);
                }}
              >
                {id}
              </button>
            ))}
            <footer>
              <button onClick={() => w.setLinkChoice(null)}>Close</button>
              {!linkChoice.external && !linkChoice.ids.length && (
                <button
                  className="primary"
                  onClick={() => {
                    const name = linkChoice.raw
                      .split(/[|#]/)[0]
                      .replace(/^\.\//, "");
                    w.setLinkChoice(null);
                    w.guard("Create a linked note?", () => {
                      setNoteSubject(
                        w.selected?.subject_id ??
                          vault!.organization.fallback_subject,
                      );
                      w.setCreate(name);
                      w.setCreateAtRoot(
                        linkChoice.raw.split(/[|#]/)[0].includes("/") ||
                          linkChoice.raw.includes("\\"),
                      );
                    });
                  }}
                >
                  Create missing note
                </button>
              )}
            </footer>
          </section>
        </div>
      )}
    </main>
  );
}
