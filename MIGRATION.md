# Organization and portable subjects

## Upgrade from v0.1

Opening a vault creates `.synapse/organization.json` schema 1. Neurons and subjects have independent UUIDs. Existing notes are indexed first, then assigned to the default Neuron using recognized frontmatter, preset folders, custom top-level folders and General. Their original paths and bytes stay unchanged. Frozen legacy note membership and original folder associations keep custom subjects stable after display renames. New managed subject roots have priority over preset inference.

New Neurons and subjects get real directories. Display names may differ from their stable directory names. **Assign to Neuron** changes the subject's parent record; it does not move directories. This preserves existing links and history. A physical folder move is outside v0.2; do not interpret the assignment command as a filesystem relocation. Subject names must be unique within a Neuron, but may repeat in different Neurons.

Review metadata moves from `flashcards.json` schema 1 to schema 2. Before conversion, the original bytes are written without overwriting an existing backup to `.synapse/flashcards-v1-backup.json`. Each currently indexed subject/card receives a copy of the matching global record, with its due date, last review, interval, ease, review count and lapse count intact. Old records remain in `legacy_cards`, including unmatched/deleted cards, for recovery. Unmatched legacy records are retained rather than automatically assigned to future imported copies.

The resulting ID is `subject_uuid:canonical_content_sha256`. Renames and assignment do not affect it. Identical content in different subject instances is independent. Within a subject, duplicates are presented once. Malformed or unsupported metadata, unknown metadata fields, and an incompatible existing backup block the affected operation and preserve the original. Organization failures prevent indexing rather than inventing a replacement registry. History failures leave notes available but disable reviews, history-bearing exports and subject imports.

## Package schema 1

A `.synapse-subject` file is a ZIP with `manifest.json` and regular files under `content/`. Explicit directory entries are not used by this format. The manifest contains:

- `schema_version: 1` and the exported subject's ID, name, color and preset.
- A map from relative file paths to SHA-256 digests and an explicit list of Markdown notes.
- Per-note WikiLink mappings: original raw link text and either an internal package-relative target or `null` for an external/unresolved reference.
- Raw-to-canonical card hash mappings, so internal path rewrites retain card identity.
- Optional review history keyed by canonical card hash. This field is `null` unless requested.

The exported subject ID records provenance; it is never adopted as ownership on import. Every import creates a new UUID. Internal WikiLinks are rewritten to explicit destination-vault paths, preserving `#heading` and `|alias`. Code, HTML blocks and YAML are excluded from WikiLink rewriting. External WikiLinks remain unchanged and are recorded as unresolved external references, preventing silent matching to another subject's notes. Edit the reference explicitly to connect it elsewhere.

Managed subjects retain relative note subfolders. Legacy subjects that span several original folders retain those vault-relative subpaths inside the package. Shared media referenced from elsewhere **inside the source vault** is copied to a hash-named attachment path and its Markdown URL is rewritten. No unrelated Markdown notes, caches or metadata are bundled. Remote links are retained without fetching. Supported attachment types are PNG/JPEG/GIF/WebP/SVG/AVIF/BMP/ICO, PDF, MP3/WAV/OGG/M4A, MP4/WebM/MOV. Inline Markdown destinations and reference definitions are recognized, including percent-encoded paths. Unsupported or missing local files cause an actionable export/import error; they are not silently omitted. Absolute local URLs and local references escaping a folder import are rejected. Obsidian media embeds and arbitrary file types are not an attachment format in v0.2; ordinary `![alt](path)` Markdown is the supported form.

## Import publication and cancellation

The source is read into a bounded immutable preview plan. Validation rejects incompatible/unknown manifest fields, invalid identity maps, unlisted content, hash mismatches, duplicate entries, file/directory conflicts, Windows case aliases at every path component, traversal, absolute/drive paths, alternate streams, reserved Windows names and symlink/reparse entries. Limits are 10,000 content files, 32 MiB per file and 256 MiB decompressed content, with bounded reads during decompression. Ordinary-folder traversal is also bounded. Only listed notes and referenced supported attachments are copied.

Cancel during source reading/validation, or cancel a completed preview, publishes nothing. The final import stages all files under `.synapse/import-*`, flushes each file, and writes `.synapse/pending-import.json`. Publication then becomes non-cancellable: the staged directory is renamed into its unique destination, history is written, and the registry is published last. Rust command serialization also serializes the watcher; a scan runs recovery before returning any snapshot. Interrupted publication resumes idempotently on refresh/reopen.

Recovery checks staged/published file digests and requires each metadata file to match the journal's before or after value. External edits pause recovery without overwriting them. Keep the journal and staging directory if such an error occurs; reconcile the reported conflict before reopening. Do not manually delete an active journal. An orphan staging directory with no journal is unpublished data left by a failure before durable publication; Synapse never scans `.synapse/` as study content.

If a destination Neuron was explicitly created in the import flow and the subsequent import fails, that empty Neuron may remain available for retry. Existing subjects are never merged. Export uses a temporary ZIP and refuses to replace an existing output filename.

Metadata and note replacement use optimistic revision checks. They do not provide a cross-process lock against another editor or cloud sync client changing files in the last filesystem operation. Portable packages should be treated as transfer artifacts, not backups of an entire vault.
