import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { FileArchive, FolderOpen, LoaderCircle, X } from "lucide-react";
import {
  subjects,
  type ImportPreview,
  type Snapshot,
  type Subject,
} from "../types";
import type { Workspace } from "../hooks/useWorkspace";
import type { Action } from "./Sidebar";
const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
export default function OrganizationDialog({
  action,
  w,
  onClose,
}: {
  action: Action;
  w: Workspace;
  onClose: () => void;
}) {
  const org = w.vault!.organization,
    subject = org.subjects.find((s) => s.id === action.id),
    neuron = org.neurons.find((n) => n.id === action.id);
  const [name, setName] = useState(
    action.kind === "rename" ? (subject?.name ?? neuron?.name ?? "") : "",
  );
  const [destination, setDestination] = useState(
    action.kind === "new-subject"
      ? (action.id ?? org.neurons[0].id)
      : (subject?.neuron_id ?? org.location.neuron_id ?? org.neurons[0].id),
  );
  const [newNeuron, setNewNeuron] = useState("");
  const [preset, setPreset] = useState<Subject>("general"),
    [color, setColor] = useState("#64748b");
  const [preview, setPreview] = useState<ImportPreview | null>(null),
    [includeHistory, setIncludeHistory] = useState(false);
  const [phase, setPhase] = useState<
    "idle" | "reading" | "publishing" | "exporting"
  >("idle");
  const [error, setError] = useState("");
  const canceled = useRef(false);
  const busy = phase !== "idle" || w.busy;
  const title = {
    "new-neuron": "New Neuron",
    "new-subject": "New subject",
    rename: "Rename",
    assign: "Assign to Neuron",
    import: "Import subject",
    export: "Export subject",
  }[action.kind];
  const close = () => {
    if (phase === "reading") {
      canceled.current = true;
      void invoke("cancel_subject_import");
      return;
    }
    if (!busy) {
      if (preview) void invoke("discard_subject_import");
      onClose();
    }
  };
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  });
  let importName = name.trim(),
    suffix = 2;
  while (
    org.subjects.some(
      (s) =>
        s.neuron_id === destination &&
        s.name.toLowerCase() === importName.toLowerCase(),
    )
  )
    importName = `${name.trim()} (${suffix++})`;
  async function choose(folder: boolean) {
    setError("");
    setPhase("reading");
    w.setBusy(true);
    canceled.current = false;
    try {
      const path = await open({
        title: folder ? "Import Markdown folder" : "Import subject package",
        directory: folder,
        multiple: false,
        ...(!folder
          ? {
              filters: [
                { name: "Synapse subject", extensions: ["synapse-subject"] },
              ],
            }
          : {}),
      });
      if (typeof path === "string" && !canceled.current) {
        const result = await invoke<ImportPreview>("inspect_subject", {
          vaultRoot: w.vault!.root,
          path,
        });
        if (!canceled.current) {
          setPreview(result);
          setName(result.name);
          setIncludeHistory(false);
        } else await invoke("discard_subject_import");
      }
    } catch (e) {
      if (!canceled.current)
        setError(
          typeof e === "object" && e && "message" in e
            ? String(e.message)
            : String(e),
        );
    } finally {
      setPhase("idle");
      w.setBusy(false);
    }
  }
  async function submit() {
    if (busy) return;
    setError("");
    try {
      if (
        action.kind === "new-neuron" ||
        action.kind === "new-subject" ||
        action.kind === "rename" ||
        action.kind === "assign"
      ) {
        const result = await w.organize(
          action.kind === "new-neuron"
            ? { kind: "new_neuron", name }
            : action.kind === "new-subject"
              ? {
                  kind: "new_subject",
                  name,
                  neuron_id: destination,
                  preset,
                  color,
                }
              : action.kind === "rename"
                ? { kind: "rename", id: action.id!, name }
                : {
                    kind: "assign",
                    subject_id: action.id!,
                    neuron_id: destination,
                  },
        );
        if (result) {
          if (action.kind === "new-neuron" || action.kind === "new-subject") {
            w.setDoc(null);
            w.setText("");
            w.setConflict(null);
          }
          onClose();
        }
        return;
      }
      if (action.kind === "export") {
        const path = await save({
          title: "Export subject",
          defaultPath: `${subject!.name.replace(/[<>:"/\\|?*]/g, "-")}.synapse-subject`,
          filters: [
            { name: "Synapse subject", extensions: ["synapse-subject"] },
          ],
        });
        if (!path) return;
        setPhase("exporting");
        w.setBusy(true);
        await invoke("export_subject", {
          vaultRoot: w.vault!.root,
          subjectId: action.id,
          path,
          includeHistory,
        });
        w.setStatus("Subject exported");
        onClose();
        return;
      }
      if (!preview) return;
      setPhase("publishing");
      w.setBusy(true);
      let nid = destination;
      if (nid === "new") {
        const next = await w.organize({ kind: "new_neuron", name: newNeuron });
        if (!next) return;
        nid = next.organization.location.neuron_id!;
        setDestination(nid);
        w.setBusy(true);
      }
      const next = await invoke<Snapshot>("import_subject", {
        vaultRoot: w.vault!.root,
        token: preview.token,
        neuronId: nid,
        name: importName,
        includeHistory,
      });
      w.setVault(next);
      w.setDoc(null);
      w.setText("");
      w.setConflict(null);
      w.setStatus(`Imported ${importName}`);
      onClose();
    } catch (e) {
      setError(
        typeof e === "object" && e && "message" in e
          ? String(e.message)
          : String(e),
      );
    } finally {
      setPhase("idle");
      w.setBusy(false);
    }
  }
  const destinationSelect = (
    <label>
      Neuron
      <select
        aria-label="Destination Neuron"
        disabled={busy}
        value={destination}
        onChange={(e) => setDestination(e.target.value)}
      >
        {org.neurons.map((n) => (
          <option key={n.id} value={n.id}>
            {n.name}
          </option>
        ))}
        {action.kind === "import" && <option value="new">New Neuron…</option>}
      </select>
    </label>
  );
  return (
    <div className="overlay">
      <form
        className="dialog glass"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <header>
          <h2>{title}</h2>
          <button
            type="button"
            aria-label="Close dialog"
            disabled={phase === "publishing" || phase === "exporting"}
            onClick={close}
          >
            <X size={18} />
          </button>
        </header>
        {action.kind === "import" && !preview && (
          <>
            <div className="import-choices">
              <button
                type="button"
                disabled={busy}
                onClick={() => void choose(false)}
              >
                <FileArchive size={22} />
                Choose package
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void choose(true)}
              >
                <FolderOpen size={22} />
                Choose folder
              </button>
            </div>
            <p>Markdown notes and their referenced attachments</p>
          </>
        )}
        {action.kind === "export" && (
          <>
            <p className="export-name">{subject?.name}</p>
            <p>
              {count(
                w.vault!.notes.filter((n) => n.subject_id === action.id).length,
                "note",
              )}{" "}
              and referenced local attachments
            </p>
            <label className="check-row">
              <input
                type="checkbox"
                checked={includeHistory}
                onChange={(e) => setIncludeHistory(e.target.checked)}
              />
              Include review history
            </label>
          </>
        )}
        {(action.kind === "new-neuron" ||
          action.kind === "new-subject" ||
          action.kind === "rename" ||
          (action.kind === "import" && preview)) && (
          <label>
            Name
            <input
              autoFocus
              maxLength={120}
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
            />
          </label>
        )}
        {(action.kind === "new-subject" ||
          action.kind === "assign" ||
          (action.kind === "import" && preview)) &&
          destinationSelect}
        {destination === "new" && (
          <label>
            New Neuron name
            <input
              required
              maxLength={120}
              value={newNeuron}
              onChange={(e) => setNewNeuron(e.target.value)}
              disabled={busy}
            />
          </label>
        )}
        {action.kind === "new-subject" && (
          <div className="form-pair">
            <label>
              Preset
              <select
                aria-label="Preset"
                value={preset}
                onChange={(e) => {
                  const next = subjects.find((s) => s.id === e.target.value)!;
                  setPreset(next.id);
                  setColor(next.color);
                  if (!name || subjects.some((s) => s.name === name))
                    setName(next.id === "general" ? "" : next.name);
                }}
              >
                <option value="general">Custom subject</option>
                {subjects
                  .filter((s) => s.id !== "general")
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Color
              <input
                aria-label="Subject color"
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
              />
            </label>
          </div>
        )}
        {(action.kind === "assign" || action.kind === "rename") && (
          <p>
            Names and organization change here. Note files keep their paths and
            review history.
          </p>
        )}
        {preview && (
          <div className="import-summary">
            <p>
              {count(preview.notes, "note")} ·{" "}
              {count(preview.attachments, "attachment")} ·{" "}
              {preview.bytes < 1024
                ? `${preview.bytes} bytes`
                : `${(preview.bytes / 1024).toFixed(1)} KB`}
            </p>
            {importName !== name.trim() && (
              <p className="notice">
                Name already exists. Import as <strong>{importName}</strong>
              </p>
            )}
            {preview.has_history && (
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={includeHistory}
                  onChange={(e) => setIncludeHistory(e.target.checked)}
                />
                Import included review history
              </label>
            )}
            {preview.external_count > 0 && (
              <details>
                <summary>
                  {count(preview.external_count, "external reference")}
                </summary>
                <p>
                  These WikiLinks keep their original text and remain unresolved
                  in this copy.
                </p>
                <ul>
                  {preview.external_references.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              </details>
            )}
            <button
              className="text-button"
              type="button"
              disabled={busy}
              onClick={() => {
                void invoke("discard_subject_import");
                setPreview(null);
              }}
            >
              Choose another source
            </button>
          </div>
        )}
        {phase !== "idle" && (
          <p className="progress" role="status">
            <LoaderCircle size={17} className="spin" />
            {phase === "reading"
              ? "Reading and validating…"
              : phase === "publishing"
                ? "Publishing subject…"
                : "Creating package…"}
          </p>
        )}
        {error && (
          <p className="form-error selectable" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button
            type="button"
            disabled={phase === "publishing" || phase === "exporting"}
            onClick={close}
          >
            Cancel
          </button>
          {!(action.kind === "import" && !preview) && (
            <button
              className="primary"
              disabled={
                busy ||
                ((action.kind === "new-neuron" ||
                  action.kind === "new-subject" ||
                  action.kind === "rename" ||
                  action.kind === "import") &&
                  !name.trim()) ||
                (destination === "new" && !newNeuron.trim())
              }
              type="submit"
            >
              {action.kind === "import"
                ? "Import subject"
                : action.kind === "export"
                  ? "Choose destination"
                  : action.kind === "assign"
                    ? "Assign subject"
                    : "Save"}
            </button>
          )}
        </footer>
      </form>
    </div>
  );
}
