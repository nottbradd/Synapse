import {
  GitBranch,
  ChevronDown,
  PanelLeftOpen,
  PanelLeftClose,
  FolderOpen,
  Search,
  X,
  FilePlus2,
  Layers,
  RefreshCw,
} from "lucide-react";
import type { Workspace } from "../hooks/useWorkspace";
import { subjects } from "../types";
type Props = Pick<
  Workspace,
  | "vault"
  | "doc"
  | "busy"
  | "query"
  | "setQuery"
  | "collapsed"
  | "setCollapsed"
  | "guard"
  | "chooseVault"
  | "openNote"
  | "setCreate"
  | "refresh"
  | "setReview"
  | "visible"
  | "due"
>;
export default function Sidebar({
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
}: Props) {
  if (!vault) return null;
  return (
    <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
      <div className="sidebar-top">
        <button
          className="vault-switch"
          title="Open another vault"
          onClick={() => void chooseVault()}
        >
          <GitBranch size={20} />
          {!collapsed && (
            <>
              <strong>Synapse</strong>
              <ChevronDown size={13} />
            </>
          )}
        </button>
        <button
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? (
            <PanelLeftOpen size={17} />
          ) : (
            <PanelLeftClose size={17} />
          )}
        </button>
      </div>
      {!collapsed && (
        <>
          <div className="vault-label">
            <FolderOpen size={13} />
            <span title={vault.root}>{vault.name}</span>
            <span className="local-dot" title="Local vault" />
          </div>
          <label className="search-box inset">
            <Search size={15} />
            <input
              placeholder="Find a note…"
              aria-label="Search notes"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button
                title="Clear search"
                aria-label="Clear search"
                onClick={() => setQuery("")}
              >
                <X size={13} />
              </button>
            )}
          </label>
          <div className="notes-heading">
            <span className="eyebrow">
              NOTES <span>{visible.length}</span>
            </span>
            <button
              aria-label="Create note"
              title="Create note"
              disabled={busy}
              onClick={() => guard("Create another note?", () => setCreate(""))}
            >
              <FilePlus2 size={16} />
            </button>
          </div>
          <nav className="note-list" aria-label="Notes">
            {visible.map((n) => (
              <button
                key={n.id}
                className={`note-item ${doc?.id === n.id ? "selected" : ""}`}
                title={n.id}
                onClick={() => openNote(n.id)}
              >
                <span
                  className="subject-dot"
                  style={{
                    background: subjects.find((s) => s.id === n.subject)!.color,
                  }}
                />
                <span>
                  <strong>{n.title}</strong>
                  <small>{n.id}</small>
                </span>
              </button>
            ))}
            {!visible.length && (
              <p className="list-empty">
                {query ? "No matching notes." : "Your next idea starts here."}
              </p>
            )}
          </nav>
          <button
            className="new-note"
            onClick={() => guard("Create another note?", () => setCreate(""))}
          >
            <FilePlus2 size={16} />
            New note
          </button>
          <div className="revision-entry">
            <button onClick={() => setReview(true)}>
              <Layers size={18} />
              <span>Revision</span>
              <span className="count">{due}</span>
            </button>
            <small>A little recall, every day.</small>
          </div>
          <div className="sidebar-footer">
            <span>
              <span className="local-dot" />
              Local workspace
            </span>
            <button
              title="Refresh vault"
              aria-label="Refresh vault"
              disabled={busy}
              onClick={() => void refresh()}
            >
              <RefreshCw size={14} className={busy ? "spin" : ""} />
            </button>
          </div>
        </>
      )}
      {collapsed && (
        <div className="collapsed-actions">
          <button
            title="New note"
            aria-label="New note"
            onClick={() => guard("Create another note?", () => setCreate(""))}
          >
            <FilePlus2 size={19} />
          </button>
          <button
            title="Revision"
            aria-label="Revision"
            onClick={() => setReview(true)}
          >
            <Layers size={19} />
          </button>
        </div>
      )}
    </aside>
  );
}
