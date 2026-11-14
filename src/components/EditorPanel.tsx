import {
  FileText,
  X,
  BookOpen,
  Layers,
  Save,
  Circle,
  Check,
} from "lucide-react";
import Editor from "./Editor";
import Markdown from "./Markdown";
import type { Workspace } from "../hooks/useWorkspace";
import { subjects } from "../types";
type Props = Pick<
  Workspace,
  | "vault"
  | "doc"
  | "setDoc"
  | "text"
  | "setText"
  | "busy"
  | "dirty"
  | "mode"
  | "setMode"
  | "panelWidth"
  | "conflict"
  | "setConflict"
  | "guard"
  | "selected"
  | "save"
  | "wiki"
  | "setError"
  | "setStatus"
  | "status"
  | "unresolved"
>;
export default function EditorPanel({
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
}: Props) {
  if (!vault || !doc) return null;
  return (
    <section className="editor-panel" style={{ width: panelWidth }}>
      <header className="editor-header">
        <div>
          <FileText size={15} />
          <span title={doc.id}>{doc.id}</span>
        </div>
        <button
          title="Close note"
          aria-label="Close note"
          onClick={() =>
            guard("Close this note?", () => {
              setDoc(null);
              setText("");
              setConflict(null);
            })
          }
        >
          <X size={17} />
        </button>
      </header>
      <div className="note-title">
        <span
          className="eyebrow"
          style={{
            color: subjects.find((s) => s.id === selected?.subject)?.color,
          }}
        >
          {subjects.find((s) => s.id === selected?.subject)?.name ?? "NOTE"}
        </span>
        <h2>{selected?.title ?? doc.id}</h2>
      </div>
      <div className="editor-toolbar">
        <div className="segmented inset">
          {(["edit", "split", "read"] as const).map((m) => (
            <button
              key={m}
              aria-pressed={mode === m}
              className={mode === m ? "active" : ""}
              onClick={() => setMode(m)}
            >
              {m === "edit" ? (
                <FileText size={13} />
              ) : m === "read" ? (
                <BookOpen size={13} />
              ) : (
                <Layers size={13} />
              )}
              <span>{m[0].toUpperCase() + m.slice(1)}</span>
            </button>
          ))}
        </div>
        <button
          className="save-button raised"
          title="Save note (Ctrl+S)"
          disabled={busy || (!dirty && !conflict)}
          onClick={() => void save()}
        >
          <Save size={14} />
          Save
        </button>
      </div>
      {conflict && (
        <div className="conflict">
          <strong>Changed outside Synapse</strong>
          <p>
            {conflict.disk
              ? "Compare the disk version below. Your edits are still in the editor."
              : "The file was deleted on disk. Your edits are still in the editor."}
          </p>
          {conflict.disk && (
            <details>
              <summary>View disk version</summary>
              <pre>{conflict.disk.content}</pre>
            </details>
          )}
          <div>
            <button
              onClick={() => {
                if (conflict.disk) {
                  setDoc(conflict.disk);
                  setText(conflict.disk.content);
                } else {
                  setDoc(null);
                  setText("");
                }
                setConflict(null);
                setError("");
              }}
            >
              Use disk version
            </button>
            <button
              onClick={() => {
                setDoc((old) =>
                  old
                    ? {
                        ...old,
                        revision: conflict.disk?.revision ?? "",
                        content: conflict.disk?.content ?? "",
                      }
                    : old,
                );
                setConflict(null);
                setError("");
                setStatus(
                  "Your edits retained — save to replace the disk version",
                );
              }}
            >
              Keep my edits
            </button>
          </div>
        </div>
      )}
      <div className={`editor-body ${mode}`}>
        {mode !== "read" && (
          <Editor
            key={doc.id}
            value={text}
            onChange={setText}
            notes={vault.notes}
            onSave={() => void save()}
          />
        )}{" "}
        {mode !== "edit" && (
          <div className="preview">
            <Markdown text={text} onWiki={wiki} />
          </div>
        )}
      </div>
      {!!unresolved.length && (
        <details className="unresolved">
          <summary>
            {unresolved.length} unresolved or ambiguous{" "}
            {unresolved.length === 1 ? "link" : "links"}
          </summary>
          {unresolved.map((l, i) => (
            <button key={i} onClick={() => wiki(l.raw)}>
              {l.raw}
              <span>
                {l.candidates.length ? "Choose target" : "Create note"}
              </span>
            </button>
          ))}
        </details>
      )}
      <footer className="editor-status">
        <span aria-live="polite">
          {dirty ? (
            <Circle size={8} fill="currentColor" />
          ) : (
            <Check size={12} />
          )}{" "}
          {dirty ? "Unsaved edits" : status}
        </span>
        <span>
          {text.trim() ? text.trim().split(/\s+/).length : 0} words{" "}
          <span className="separator">·</span> Markdown
        </span>
      </footer>
    </section>
  );
}
