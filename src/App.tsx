import {
  ArrowRight,
  FolderOpen,
  GitBranch,
  LoaderCircle,
  X,
  AlertTriangle,
} from "lucide-react";
import { subjects } from "./types";
import { wikiTarget } from "./wiki";
import { useWorkspace } from "./hooks/useWorkspace";
import Graph from "./components/Graph";
import Review from "./components/Review";
import Sidebar from "./components/Sidebar";
import EditorPanel from "./components/EditorPanel";
import { useModalFocus } from "./hooks/useModalFocus";
export default function App() {
  const {
    vault,
    setVault,
    doc,
    setDoc,
    text,
    setText,
    busy,
    error,
    setError,
    status,
    setStatus,
    query,
    setQuery,
    collapsed,
    setCollapsed,
    filters,
    setFilters,
    mode,
    setMode,
    panelWidth,
    setPanelWidth,
    review,
    setReview,
    create,
    setCreate,
    pending,
    setPending,
    conflict,
    setConflict,
    linkChoice,
    setLinkChoice,
    dirty,
    guard,
    chooseVault,
    openNote,
    save,
    wiki,
    createNote,
    refresh,
    rate,
    visible,
    due,
    selected,
    unresolved,
  } = useWorkspace();
  useModalFocus(
    linkChoice
      ? "link"
      : pending
        ? "unsaved"
        : create !== null
          ? "create"
          : review
            ? "review"
            : "",
  );
  return (
    <main className="app select-none">
      {!vault ? (
        <div className="welcome">
          <div className="brand-mark">
            <GitBranch size={30} strokeWidth={1.5} />
          </div>
          <span className="eyebrow">SYNAPSE / A LOCAL STUDY WORKSPACE</span>
          <h1>
            Your notes.
            <br />
            <span>A clearer connection.</span>
          </h1>
          <p>
            Think in Markdown. Follow an idea.
            <br />
            Remember what matters.
          </p>
          <button
            className="primary"
            disabled={busy}
            onClick={() => void chooseVault()}
          >
            {busy ? (
              <LoaderCircle className="spin" size={17} />
            ) : (
              <FolderOpen size={17} />
            )}
            Open vault
            <ArrowRight size={16} />
          </button>
          <small>
            Choose a folder of Markdown notes.
            <br />
            Your files stay yours. Everything works offline.
          </small>
          <div className="welcome-foot">
            DESIGNED FOR FOCUSED STUDY <span>VCE UNITS 3 / 4</span>
          </div>
        </div>
      ) : (
        <>
          <Sidebar
            {...{
              vault,
              doc,
              busy,
              query,
              setQuery,
              collapsed,
              setCollapsed,
              guard,
              chooseVault,
              openNote,
              setCreate,
              refresh,
              setReview,
              visible,
              due,
            }}
          />
          <section className="workspace">
            <header className="workspace-header">
              <div>
                <GitBranch size={15} />
                <span>Connections</span>
              </div>
              <div
                className="subject-filters"
                aria-label="Graph subject filters"
              >
                {subjects.map((s) => (
                  <button
                    key={s.id}
                    aria-pressed={filters.has(s.id)}
                    title={s.name}
                    className={!filters.has(s.id) ? "off" : ""}
                    onClick={() =>
                      setFilters((old) => {
                        const next = new Set(old);
                        if (next.has(s.id)) next.delete(s.id);
                        else next.add(s.id);
                        return next;
                      })
                    }
                  >
                    <span
                      className="subject-dot"
                      style={{ background: s.color }}
                    />
                    {s.short}
                  </button>
                ))}
              </div>
            </header>
            <div className="work-panels">
              <Graph
                snapshot={vault}
                selected={doc?.id}
                query={query}
                filters={filters}
                onOpen={openNote}
              />
              {doc && (
                <>
                  <div
                    className="resize-handle"
                    role="separator"
                    tabIndex={0}
                    aria-label="Resize editor"
                    aria-orientation="vertical"
                    aria-valuemin={360}
                    aria-valuemax={1000}
                    aria-valuenow={panelWidth}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowLeft")
                        setPanelWidth((w) => Math.min(1000, w + 30));
                      if (e.key === "ArrowRight")
                        setPanelWidth((w) => Math.max(360, w - 30));
                    }}
                    onPointerDown={(e) => {
                      e.currentTarget.setPointerCapture(e.pointerId);
                    }}
                    onPointerMove={(e) => {
                      if (e.currentTarget.hasPointerCapture(e.pointerId))
                        setPanelWidth(
                          Math.max(
                            360,
                            Math.min(1000, window.innerWidth - e.clientX),
                          ),
                        );
                    }}
                  />
                  <EditorPanel
                    {...{
                      vault,
                      doc,
                      setDoc,
                      text,
                      setText,
                      busy,
                      dirty,
                      mode,
                      setMode,
                      panelWidth,
                      conflict,
                      setConflict,
                      guard,
                      selected,
                      save,
                      wiki,
                      setError,
                      setStatus,
                      status,
                      unresolved,
                    }}
                  />
                </>
              )}
            </div>
          </section>
        </>
      )}
      {(error || !!vault?.warnings.length) && (
        <div className="notification" role="alert">
          <AlertTriangle size={17} />
          <div className="selectable">
            {error || vault?.warnings.join("\n")}
          </div>
          <button
            aria-label="Dismiss notification"
            title="Dismiss"
            onClick={() => {
              setError("");
              if (vault) setVault({ ...vault, warnings: [] });
            }}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {review && vault && (
        <Review
          snapshot={vault}
          onRate={rate}
          onClose={() => setReview(false)}
          onSource={openNote}
          onWiki={wiki}
        />
      )}
      {create !== null && (
        <div className="overlay">
          <form
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Create note"
            onSubmit={(e) => {
              e.preventDefault();
              void createNote();
            }}
          >
            <span className="eyebrow">NEW NOTE</span>
            <h2>Make room for an idea.</h2>
            <label>
              Vault-relative path
              <input
                autoFocus
                placeholder="Physics/Electromagnetic induction"
                value={create}
                onChange={(e) => setCreate(e.target.value)}
              />
            </label>
            <p>
              Use folders to organize your notes. The .md extension is added
              automatically.
            </p>
            <footer>
              <button
                type="button"
                disabled={busy}
                onClick={() => setCreate(null)}
              >
                Cancel
              </button>
              <button
                className="primary"
                disabled={busy || !create.trim()}
                type="submit"
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
            className="dialog"
            role="alertdialog"
            aria-modal="true"
            aria-label={pending.title}
          >
            <h2>{pending.title}</h2>
            <p>{pending.detail}</p>
            <footer>
              <button disabled={busy} onClick={() => setPending(null)}>
                Cancel
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  const action = pending.action;
                  setPending(null);
                  action();
                }}
              >
                Discard edits
              </button>
              <button
                className="primary"
                disabled={busy}
                onClick={() => {
                  void save().then((ok) => {
                    if (ok) {
                      const action = pending.action;
                      setPending(null);
                      action();
                    } else setPending(null);
                  });
                }}
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
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Resolve WikiLink"
          >
            <span className="eyebrow">WIKILINK</span>
            <h2>
              {linkChoice.ids.length
                ? "Choose a note"
                : "A connection waiting to happen."}
            </h2>
            <p className="selectable">[[{linkChoice.raw}]]</p>
            {linkChoice.ids.map((id) => (
              <button
                className="choice"
                key={id}
                onClick={() => {
                  setLinkChoice(null);
                  openNote(id);
                }}
              >
                {id}
                <ArrowRight size={14} />
              </button>
            ))}
            <footer>
              <button onClick={() => setLinkChoice(null)}>Cancel</button>
              {!linkChoice.ids.length && (
                <button
                  className="primary"
                  onClick={() => {
                    const path = wikiTarget(linkChoice.raw).replace(
                      /^\.\//,
                      "",
                    );
                    setLinkChoice(null);
                    guard("Create linked note?", () => {
                      setReview(false);
                      setCreate(path);
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
