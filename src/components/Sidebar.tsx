import { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Layers,
  Network,
  Waypoints,
  Settings2,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Search,
  Upload,
  X,
} from "lucide-react";
import type { Workspace } from "../hooks/useWorkspace";
import NoteTree from "./NoteTree";
export type Action = {
  kind:
    "new-neuron" | "new-subject" | "rename" | "assign" | "import" | "export";
  id?: string;
};
export default function Sidebar({
  w,
  onAction,
  onNewNote,
  onPreferences,
  onStudy,
  remindersReady,
}: {
  w: Workspace;
  onAction: (a: Action) => void;
  onNewNote: (subject?: string) => void;
  onPreferences: () => void;
  onStudy: (view: "create" | "library") => void;
  remindersReady: number;
}) {
  const {
    vault,
    collapsed,
    setCollapsed,
    busy,
    query,
    setQuery,
    visible,
    doc,
    openNote,
    selectLocation,
  } = w;
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const bySubject = useMemo(() => {
    const groups = new Map<string, typeof visible>();
    for (const n of visible) {
      const arr = groups.get(n.subject_id);
      if (arr) arr.push(n);
      else groups.set(n.subject_id, [n]);
    }
    return groups;
  }, [visible]);
  const [menu, setMenu] = useState<{
    id: string;
    neuron: boolean;
    top: number;
  } | null>(null);
  useEffect(() => {
    if (!menu) return;
    document.querySelector<HTMLButtonElement>(".context-menu button")?.focus();
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenu(null);
        document
          .querySelector<HTMLButtonElement>(`[data-menu-id="${menu.id}"]`)
          ?.focus();
      }
    };
    const arrows = (e: KeyboardEvent) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const buttons = Array.from(
        document.querySelectorAll<HTMLButtonElement>(".context-menu button"),
      );
      const index = buttons.indexOf(
        document.activeElement as HTMLButtonElement,
      );
      buttons[
        (index + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) %
          buttons.length
      ]?.focus();
    };
    window.addEventListener("keydown", arrows);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("keydown", close);
      window.removeEventListener("keydown", arrows);
    };
  }, [menu]);
  if (!vault) return null;
  const org = vault.organization,
    location = org.location,
    allNotes = w.exploration.scope.kind === "all-notes";
  const toggle = (id: string) =>
    setClosed((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const action = (a: Action) => {
    if (menu)
      document
        .querySelector<HTMLButtonElement>(`[data-menu-id="${menu.id}"]`)
        ?.focus();
    setMenu(null);
    onAction(a);
  };
  const disclosure = (id: string, name: string) => (
    <button
      className="disclosure"
      aria-label={`${closed.has(id) ? "Expand" : "Collapse"} ${name}`}
      aria-expanded={!closed.has(id)}
      onClick={() => toggle(id)}
    >
      {closed.has(id) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
    </button>
  );
  const more = (id: string, neuron: boolean) => (
    <button
      data-menu-id={id}
      className="row-more"
      title="More actions"
      aria-label={`Actions for ${neuron ? org.neurons.find((n) => n.id === id)?.name : org.subjects.find((s) => s.id === id)?.name}`}
      aria-expanded={menu?.id === id}
      onClick={(e) =>
        setMenu(
          menu?.id === id
            ? null
            : {
                id,
                neuron,
                top: Math.min(
                  e.currentTarget.getBoundingClientRect().bottom,
                  window.innerHeight - 228,
                ),
              },
        )
      }
    >
      <MoreHorizontal size={16} />
    </button>
  );
  return (
    <>
      <aside
        className={`sidebar glass ${collapsed ? "collapsed" : ""}`}
        aria-label="Vault navigation"
        data-swarm-surface=""
      >
        <header className="sidebar-head">
          <span className="brand">
            <Waypoints size={19} data-swarm="box" />
            {!collapsed && <span data-swarm="text">Synapse</span>}
          </span>
          <button
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            data-swarm="box"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? (
              <PanelLeftOpen size={17} />
            ) : (
              <PanelLeftClose size={17} />
            )}
          </button>
        </header>
        {collapsed ? (
          <div className="rail" data-swarm="box">
            <button
              title="All Notes"
              aria-label="All Notes"
              aria-current={allNotes ? "page" : undefined}
              onClick={() => w.navigateGraph("all-notes")}
            >
              <Network size={18} />
            </button>
            <button
              title="Create study material"
              aria-label="Create study material"
              onClick={() => onStudy("create")}
            >
              <Plus size={18} />
            </button>
            <button
              title="Study library"
              aria-label="Study library"
              onClick={() => onStudy("library")}
            >
              <BookOpen size={18} />
            </button>
            <button
              title="Preferences"
              aria-label="Preferences"
              onClick={onPreferences}
            >
              <Settings2 size={18} />
            </button>
            <button
              title="Search notes"
              aria-label="Search notes"
              onClick={() => {
                setCollapsed(false);
                setTimeout(
                  () => document.getElementById("note-search")?.focus(),
                  0,
                );
              }}
            >
              <Search size={18} />
            </button>
            <button
              title="New note"
              aria-label="New note"
              disabled={busy}
              onClick={() => onNewNote()}
            >
              <Plus size={19} />
            </button>
            <button
              title="Review"
              aria-label="Review"
              onClick={() => w.guard("Start review?", () => w.setReview(true))}
            >
              <BookOpen size={19} />
            </button>
            <button
              title="Open vault"
              aria-label="Open vault"
              disabled={busy}
              onClick={() => void w.chooseVault()}
            >
              <FolderOpen size={19} />
            </button>
          </div>
        ) : (
          <>
            <div className="vault-heading" data-swarm="box">
              <strong title={vault.root} data-swarm-label="">
                {vault.name}
              </strong>
              <button
                title="Open vault"
                aria-label="Open vault"
                disabled={busy}
                onClick={() => void w.chooseVault()}
              >
                <FolderOpen size={17} />
              </button>
            </div>
            <label className="search" data-swarm="box">
              <Search size={16} />
              <input
                id="note-search"
                data-swarm-label=""
                aria-label="Search notes"
                placeholder="Search notes"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button aria-label="Clear search" onClick={() => setQuery("")}>
                  <X size={14} />
                </button>
              )}
            </label>
            <button
              className="new-note"
              data-swarm="box"
              disabled={busy}
              onClick={() => onNewNote()}
            >
              <Plus size={17} />
              <span data-swarm-label="">New note</span>
            </button>
            <nav className="hierarchy" aria-label="Neurons and subjects">
              <div className="vault-views" data-swarm="box">
                <button
                  className={`all-row ${!allNotes && !location.neuron_id ? "selected" : ""}`}
                  aria-current={
                    !allNotes && !location.neuron_id ? "page" : undefined
                  }
                  onClick={() =>
                    selectLocation({ neuron_id: null, subject_id: null })
                  }
                >
                  <Layers size={16} />
                  <span data-swarm-label="">All Neurons</span>
                </button>
                <button
                  className={`all-row ${allNotes ? "selected" : ""}`}
                  aria-current={allNotes ? "page" : undefined}
                  onClick={() => w.navigateGraph("all-notes")}
                >
                  <Network size={16} />
                  <span data-swarm-label="">All Notes</span>
                </button>
              </div>
              {org.neurons.map((neuron) => (
                <div className="neuron-group" key={neuron.id}>
                  <div
                    className={`tree-row neuron-row ${!allNotes && location.neuron_id === neuron.id && !location.subject_id ? "selected" : ""}`}
                    data-swarm="box"
                  >
                    {disclosure(neuron.id, neuron.name)}
                    <button
                      className="row-name"
                      data-swarm-label=""
                      title={neuron.name}
                      aria-current={
                        !allNotes &&
                        location.neuron_id === neuron.id &&
                        !location.subject_id
                          ? "page"
                          : undefined
                      }
                      onClick={() =>
                        selectLocation({
                          neuron_id: neuron.id,
                          subject_id: null,
                        })
                      }
                    >
                      {neuron.name}
                    </button>
                    {more(neuron.id, true)}
                  </div>
                  {(!closed.has(neuron.id) || query) &&
                    org.subjects
                      .filter((s) => s.neuron_id === neuron.id)
                      .map((subject) => {
                        const notes = bySubject.get(subject.id) ?? [];
                        return (
                          <div key={subject.id} className="subject-group">
                            <div
                              className={`tree-row subject-row ${!allNotes && location.subject_id === subject.id ? "selected" : ""}`}
                              data-swarm="duplicate"
                            >
                              {disclosure(subject.id, subject.name)}
                              <span
                                className="subject-dot"
                                style={{ background: subject.color }}
                              />
                              <button
                                className="row-name"
                                data-swarm-label=""
                                title={subject.name}
                                aria-current={
                                  !allNotes &&
                                  location.subject_id === subject.id
                                    ? "page"
                                    : undefined
                                }
                                onClick={() =>
                                  selectLocation({
                                    neuron_id: neuron.id,
                                    subject_id: subject.id,
                                  })
                                }
                              >
                                {subject.name}
                              </button>
                              {more(subject.id, false)}
                            </div>
                            {(!closed.has(subject.id) || query) && (
                              <div className="note-rows" data-swarm="box">
                                <NoteTree
                                  notes={notes}
                                  subject={subject}
                                  selected={doc?.id}
                                  closed={closed}
                                  query={query}
                                  toggle={toggle}
                                  open={openNote}
                                />
                                {!notes.length && (
                                  <span className="tree-empty">
                                    {query ? "No matches" : "No notes"}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                </div>
              ))}
            </nav>
            <div className="sidebar-actions" data-swarm="box">
              <button
                disabled={busy}
                onClick={() => action({ kind: "new-neuron" })}
              >
                <Plus size={16} />
                New Neuron
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  action({
                    kind: "new-subject",
                    id: location.neuron_id ?? org.neurons[0]?.id,
                  })
                }
              >
                <Plus size={16} />
                New subject
              </button>
              <button
                disabled={busy}
                onClick={() => action({ kind: "import" })}
              >
                <Upload size={16} />
                Import subject
              </button>
            </div>
            <footer className="sidebar-footer" data-swarm="box">
              <div className="study-entries">
                <button onClick={() => onStudy("create")}>
                  <Plus size={17} />
                  <span data-swarm-label="">Create</span>
                </button>
                <button onClick={() => onStudy("library")}>
                  <BookOpen size={17} />
                  <span data-swarm-label="">Study library</span>
                  {remindersReady > 0 && <span>{remindersReady}</span>}
                </button>
              </div>
              <button
                title="Preferences"
                aria-label="Preferences"
                onClick={onPreferences}
              >
                <Settings2 size={16} />
              </button>
              <button
                className="review-entry"
                disabled={busy}
                onClick={() =>
                  w.guard("Start review?", () => w.setReview(true))
                }
              >
                <BookOpen size={17} />
                <span data-swarm-label="">Review</span> <span>{w.due}</span>
              </button>
              <button
                title="Refresh vault"
                aria-label="Refresh vault"
                disabled={busy}
                onClick={() => void w.refresh()}
              >
                <RefreshCw size={16} />
              </button>
            </footer>
          </>
        )}
      </aside>
      {menu && (
        <>
          <div className="menu-dismiss" onClick={() => setMenu(null)} />
          <div
            className="context-menu glass"
            role="menu"
            aria-label="Organization actions"
            style={{ top: menu.top, left: collapsed ? 80 : 144 }}
          >
            <button
              role="menuitem"
              onClick={() => action({ kind: "rename", id: menu.id })}
            >
              Rename
            </button>
            {menu.neuron ? (
              <button
                role="menuitem"
                onClick={() => action({ kind: "new-subject", id: menu.id })}
              >
                New subject
              </button>
            ) : (
              <>
                <button
                  role="menuitem"
                  onClick={() => {
                    setMenu(null);
                    onNewNote(menu.id);
                  }}
                >
                  New note
                </button>
                <button
                  role="menuitem"
                  onClick={() => action({ kind: "assign", id: menu.id })}
                >
                  Assign to Neuron
                </button>
                <button
                  role="menuitem"
                  onClick={() => action({ kind: "export", id: menu.id })}
                >
                  Export subject
                </button>
              </>
            )}
          </div>
        </>
      )}
    </>
  );
}
