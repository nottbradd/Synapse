import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import {
  subjects,
  message,
  type Document,
  type Snapshot,
  type Subject,
  type Rating,
} from "../types";
import { resolveWiki } from "../wiki";
type Pending = { title: string; detail: string; action: () => void };
export function useWorkspace() {
  const [vault, setVault] = useState<Snapshot | null>(null),
    [doc, setDoc] = useState<Document | null>(null),
    [text, setText] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState("All changes saved"),
    [query, setQuery] = useState(""),
    [collapsed, setCollapsed] = useState(false);
  const [filters, setFilters] = useState(
      new Set<Subject>(subjects.map((s) => s.id)),
    ),
    [mode, setMode] = useState<"edit" | "split" | "read">("split"),
    [panelWidth, setPanelWidth] = useState(650);
  const [review, setReview] = useState(false),
    [create, setCreate] = useState<string | null>(null),
    [pending, setPending] = useState<Pending | null>(null),
    [conflict, setConflict] = useState<{ disk: Document | null } | null>(null);
  const [linkChoice, setLinkChoice] = useState<{
    raw: string;
    ids: string[];
  } | null>(null);
  const dirty = !!doc && text !== doc.content;
  const current = useRef({ vault, doc, text, dirty, busy });
  current.current = { vault, doc, text, dirty, busy };
  const loadSerial = useRef(0);
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(t);
  }, []);
  const fail = useCallback((e: unknown) => {
    setError(message(e));
  }, []);
  const applySnapshot = useCallback(
    async (next: Snapshot) => {
      const old = current.current;
      if (old.vault && old.vault.root !== next.root) return;
      setVault((previous) =>
        previous && JSON.stringify(previous) === JSON.stringify(next)
          ? previous
          : next,
      );
      if (!old.doc) return;
      const info = next.notes.find((n) => n.id === old.doc!.id);
      if (info?.revision === old.doc.revision) return;
      try {
        const disk = info
          ? await invoke<Document>("read_note", {
              vaultRoot: next.root,
              id: old.doc.id,
            })
          : null;
        if (
          current.current.doc?.id !== old.doc.id ||
          current.current.vault?.root !== next.root
        )
          return;
        if (current.current.dirty) {
          setConflict({ disk });
          setStatus("Disk changes need your attention");
        } else if (disk) {
          setDoc(disk);
          setText(disk.content);
          setStatus("Updated from disk");
        } else {
          setDoc(null);
          setText("");
          setStatus("Note removed from disk");
        }
      } catch (e) {
        fail(e);
      }
    },
    [fail],
  );
  useEffect(() => {
    if (!isTauri()) {
      setError(
        "Open Synapse as a desktop app to access your local vault. Run npm run tauri dev.",
      );
      return;
    }
    let cancelled = false;
    setBusy(true);
    void invoke<Snapshot | null>("restore_vault")
      .then((s) => {
        if (!cancelled) setVault(s);
      })
      .catch(fail)
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    const unlisten = listen<Snapshot>("vault-changed", (e) => {
      void applySnapshot(e.payload);
    });
    const unerror = listen<string>("watcher-error", (e) =>
      setError(`File watcher: ${e.payload}. Use Refresh to rescan.`),
    );
    return () => {
      cancelled = true;
      void unlisten.then((f) => f());
      void unerror.then((f) => f());
    };
  }, [applySnapshot, fail]);
  const guard = useCallback((title: string, action: () => void) => {
    if (current.current.busy) return;
    if (current.current.dirty)
      setPending({
        title,
        detail:
          "This note has unsaved edits. Save them before continuing, or explicitly discard them.",
        action,
      });
    else action();
  }, []);
  useEffect(() => {
    if (!isTauri()) return;
    const cleanup = getCurrentWindow().onCloseRequested((e) => {
      if (current.current.dirty || current.current.busy) {
        e.preventDefault();
        guard("Close Synapse?", () => {
          void getCurrentWindow().destroy();
        });
      }
    });
    return () => {
      void cleanup.then((f) => f());
    };
  }, [guard]);
  async function chooseVault() {
    guard("Switch vault?", () => {
      void (async () => {
        setBusy(true);
        setError("");
        try {
          const path = await open({
            directory: true,
            multiple: false,
            title: "Open a Markdown vault",
          });
          if (typeof path === "string") {
            const s = await invoke<Snapshot>("open_vault", { path });
            loadSerial.current++;
            setVault(s);
            setDoc(null);
            setText("");
            setConflict(null);
            setQuery("");
            setReview(false);
          }
        } catch (e) {
          fail(e);
        } finally {
          setBusy(false);
        }
      })();
    });
  }
  function openNote(id: string) {
    guard("Open another note?", () => {
      void (async () => {
        const root = current.current.vault?.root;
        if (!root) return;
        const serial = ++loadSerial.current;
        setBusy(true);
        setError("");
        try {
          const next = await invoke<Document>("read_note", {
            vaultRoot: root,
            id,
          });
          if (serial === loadSerial.current) {
            setDoc(next);
            setText(next.content);
            setConflict(null);
            setReview(false);
            setStatus("All changes saved");
          }
        } catch (e) {
          fail(e);
        } finally {
          if (serial === loadSerial.current) setBusy(false);
        }
      })();
    });
  }
  async function save(): Promise<boolean> {
    const state = current.current;
    if (!state.doc || !state.vault || state.busy) return false;
    setBusy(true);
    setError("");
    setStatus("Saving…");
    try {
      const next = await invoke<Snapshot>("save_note", {
        vaultRoot: state.vault.root,
        id: state.doc.id,
        content: state.text,
        revision: state.doc.revision || null,
      });
      setVault(next);
      const revision = next.notes.find((n) => n.id === state.doc!.id)?.revision;
      if (!revision)
        throw new Error(
          "The note was saved but could not be indexed. Refresh to inspect it.",
        );
      setDoc({ ...state.doc, content: state.text, revision });
      setConflict(null);
      setStatus("All changes saved");
      return true;
    } catch (e) {
      if (typeof e === "object" && e && "code" in e && e.code === "conflict") {
        try {
          const disk = await invoke<Document>("read_note", {
            vaultRoot: state.vault.root,
            id: state.doc.id,
          });
          setConflict({ disk });
        } catch {
          setConflict({ disk: null });
        }
      }
      fail(e);
      setStatus("Save failed — edits retained");
      return false;
    } finally {
      setBusy(false);
    }
  }
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      // CodeMirror handles Mod-S inside the editor; do not issue a second save.
      if (e.defaultPrevented) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveRef.current();
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, []);
  function wiki(raw: string, source = doc?.id ?? "") {
    if (!vault) return;
    const targets = resolveWiki(raw, source, vault.notes);
    if (targets.length === 1) openNote(targets[0].id);
    else setLinkChoice({ raw, ids: targets.map((n) => n.id) });
  }
  async function createNote() {
    if (create === null || !vault || busy) return;
    setBusy(true);
    setError("");
    const id =
      create.trim().replaceAll("\\", "/").replace(/\.md$/i, "") + ".md";
    try {
      const content = `# ${id.split("/").pop()!.slice(0, -3)}\n\n`;
      const next = await invoke<Snapshot>("save_note", {
        vaultRoot: vault.root,
        id,
        content,
        revision: null,
      });
      setVault(next);
      const created = await invoke<Document>("read_note", {
        vaultRoot: vault.root,
        id,
      });
      setDoc(created);
      setText(created.content);
      setCreate(null);
      setConflict(null);
      setStatus("Note created");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    if (!vault || busy) return;
    setBusy(true);
    try {
      await applySnapshot(
        await invoke<Snapshot>("refresh_vault", { vaultRoot: vault.root }),
      );
      setStatus("Vault refreshed");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function rate(id: string, rating: Rating) {
    if (!vault) return false;
    try {
      const next = await invoke<Snapshot>("rate_card", {
        vaultRoot: vault.root,
        id,
        rating,
      });
      setVault(next);
      return true;
    } catch (e) {
      fail(e);
      return false;
    }
  }
  const visible =
    vault?.notes.filter((n) =>
      `${n.title} ${n.id}`.toLowerCase().includes(query.toLowerCase()),
    ) ?? [];
  const due =
    vault?.cards.filter(
      (c) => !vault.history.cards[c.id] || vault.history.cards[c.id].due <= now,
    ).length ?? 0;
  const selected = vault?.notes.find((n) => n.id === doc?.id);
  const unresolved =
    vault?.links.filter((l) => l.source === doc?.id && !l.target) ?? [];
  return {
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
  };
}
export type Workspace = ReturnType<typeof useWorkspace>;
