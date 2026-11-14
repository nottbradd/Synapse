import { ChevronDown, ChevronRight, FileText, Folder } from "lucide-react";
import type { Note, SubjectRecord } from "../types";
type Branch = { folders: Map<string, Branch>; notes: Note[] };
export default function NoteTree({
  notes,
  subject,
  selected,
  closed,
  query,
  toggle,
  open,
}: {
  notes: Note[];
  subject: SubjectRecord;
  selected?: string;
  closed: Set<string>;
  query: string;
  toggle: (id: string) => void;
  open: (id: string) => void;
}) {
  const tree: Branch = { folders: new Map(), notes: [] };
  const first = notes[0]?.id.split("/")[0];
  const legacyPrefix =
    first && notes.every((n) => n.id.startsWith(first + "/"))
      ? first + "/"
      : "";
  for (const note of notes) {
    const relative =
      subject.root && note.id.startsWith(subject.root + "/")
        ? note.id.slice(subject.root.length + 1)
        : note.id.slice(legacyPrefix.length);
    const parts = relative.split("/");
    parts.pop();
    let branch = tree;
    for (const p of parts) {
      if (!branch.folders.has(p))
        branch.folders.set(p, { folders: new Map(), notes: [] });
      branch = branch.folders.get(p)!;
    }
    branch.notes.push(note);
  }
  function render(
    branch: Branch,
    depth: number,
    path: string,
  ): React.ReactNode {
    return (
      <>
        {[...branch.folders]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([name, child]) => {
            const id = `${subject.id}:${path}/${name}`;
            return (
              <div key={id}>
                <button
                  className="folder-row"
                  title={name}
                  style={{ paddingLeft: 32 + depth * 12 }}
                  aria-expanded={!closed.has(id)}
                  onClick={() => toggle(id)}
                >
                  {closed.has(id) ? (
                    <ChevronRight size={12} />
                  ) : (
                    <ChevronDown size={12} />
                  )}
                  <Folder size={13} />
                  <span>{name}</span>
                </button>
                {(!closed.has(id) || query) &&
                  render(child, depth + 1, `${path}/${name}`)}
              </div>
            );
          })}
        {branch.notes.map((note) => (
          <button
            className={`note-row ${selected === note.id ? "active" : ""}`}
            style={{ paddingLeft: 44 + depth * 12 }}
            key={note.id}
            title={note.id}
            onClick={() => open(note.id)}
            aria-current={selected === note.id ? "true" : undefined}
          >
            <FileText size={14} />
            <span>{note.title}</span>
          </button>
        ))}
      </>
    );
  }
  return <>{render(tree, 0, "")}</>;
}
