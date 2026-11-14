# Synapse 0.2 validation

Executed on Windows x64 on 14–15 November 2026 (Australia/Sydney). Desktop tests used generated study data under ignored `.local/` directories and the Windows temporary directory. No personal study vault was used. The v0.1 validation record remains in Git history.

## Automated checks

| Check                                                                                     | Result                                               |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `npm run typecheck`                                                                       | Passed                                               |
| `npm run lint`                                                                            | Passed                                               |
| `npm test`                                                                                | 7 tests passed                                       |
| `cargo test --locked --manifest-path src-tauri/Cargo.toml`                                | 18 tests passed                                      |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check`                                  | Passed                                               |
| `cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | Passed                                               |
| `npm audit`                                                                               | 0 vulnerabilities reported                           |
| `npm run tauri build`                                                                     | Vite, Rust release and Windows NSIS packaging passed |

The Rust suite retains the original seven tests and adds eleven organization/transfer regressions. Coverage includes legacy subject inference and unchanged note bytes, General/unassigned notes, stable custom-folder membership after rename, duplicate subject names in different Neurons, managed roots overriding presets, stable identities after rename/assignment, and copying every legacy scheduling field with a byte-for-byte backup. Malformed and unsupported metadata remain intact.

Transfer tests cover empty and populated package round trips, attachments, aliases and heading fragments, internal remapping, external references, canonical card identities, both history opt-ins, name conflicts, cancellation, missing/escaped attachment paths, malicious archives, case and file/directory collisions, decompression limits, and journal recovery with external-edit preservation. Existing containment tests include Windows junction escapes. The 500-note/500-edge/500-card indexing fixture still passes; no new performance benchmark is claimed. Two frontend label-layout tests verify measured bounds, collision avoidance, truncation, priority and distant-zoom culling; five WikiLink tests remain.

The build reports a bundle-size advisory: about 1.47 MB JavaScript before compression, 479 KB compressed. Assets and KaTeX fonts are embedded. The executable is 13,665,792 bytes and the NSIS installer is 4,262,545 bytes (4.07 MiB). The installer is unsigned. Installer generation was tested; the installation wizard was not run.

## Actual desktop integration

The harnesses attach through CDP to the real Tauri WebView2 application. Rust commands, file watching and filesystem persistence are real. They collect both uncaught page errors and console errors. A final development-log review found a synchronous zoom callback updating React state during the Canvas wrapper's resize render; deferring and coalescing that update removed the warning. The subsequent development hierarchy/transfer runs and final packaged hierarchy/release runs reported neither page nor console errors.

`scripts/update-desktop.mjs` passed on the final packaged executable. It creates a fresh 97-note fixture across VCE Revision, University and Research Neurons, including duplicate Physics subjects and a dense 90-note subject. It verifies creation, location/graph/review scoping, custom subjects, KaTeX, unsaved-edit protection, an external disk conflict, saving, and independent progress for identical cards. It captures editor-open/closed and 900×600, 1440×900 and 1600×1000 layouts.

`scripts/release-verify.mjs` passed on the final packaged executable, after the update harness. It verifies:

- Nested note creation and explicit vault-relative missing-WikiLink creation.
- Native close-request protection while edits are unsaved, cancellation and saving.
- Loading the packaged `http://tauri.localhost/` page with WebView2 offline network emulation, editing/saving, KaTeX and a persisted review rating.
- A pixel-identical graph canvas and unchanged zoom after an ordinary external body edit, preserving camera and node positions.
- Search, Escape dismissal, focus restoration to the dialog opener, reduced-motion emulation and an opaque glass fallback.
- Empty-vault rendering and restoration of the previously selected subject.
- 150% and 200% WebView device-density emulation at 1000×700 CSS pixels. Canvas backing widths are 1500 and 2000 respectively, with no horizontal overflow.

A separate final executable restart restored the selected Research subject and both persisted review records, comparing the restored history with the saved file. Offline testing did not change Windows adapter settings. Display-density testing exercised the Windows WebView renderer through Chromium emulation; Windows display settings were not changed, and moving between monitors of different DPI was not tested.

`scripts/transfer-desktop.mjs` exercises the development desktop. It supplies native chooser responses at the JavaScript module boundary and uses the real Rust backend for everything thereafter: export excluding history by default, previewing a package with history, leaving its import option off, a safe Physics copy name, a new subject UUID, independent progress, ordinary-folder import, destination-Neuron creation, selected attachments, internal/external links, cancellation and a useful malformed-package error. Its generated source includes an unrelated secret-named file and verifies that file is not copied. The script creates its own history-bearing source package from the update fixture.

The final transfer rerun initially encountered Windows error 5 during directory publication inside this checkout. Inspection found an inherited `Everyone: Deny DeleteSubdirectoriesAndFiles` ACL. The destination remained absent, the journal and stage remained available, and organization/history matched their original bytes. The same UI flow passed in a fresh temporary vault. Copying the paused synthetic fixture to the temporary directory also allowed the real recovery command to finish, producing 102 notes and eight subjects with the exact journaled organization/history. The protected source remained unchanged. No ACL or security setting was modified. Vaults need filesystem permission to rename staged directories; an error under restrictive permissions is preserved for recovery rather than bypassed.

Native Windows package/folder picker rendering was inspected. The Windows Security prompt was dismissed by the user. The automation helper continued to report stale child elements or incorrect focus inside the picker, so a complete native selection/save cycle is **not claimed as passed**. The chooser-response substitution above is explicit; it does not replace archive, validation or persistence behavior.

## Visual inspection

Screenshots from the desktop application were inspected for multiple Neurons and duplicate subjects, long names, dense labels, empty states, editor layout, rendered mathematics, export/import previews and conflicts, and small/large windows. The measured-label pass keeps readable text at a consistent size, truncates long titles, and removes lower-priority labels when space is insufficient. The 150%/200% screenshots show aligned nodes and labels; the opaque fallback remains readable. Synthetic screenshots and harness results are retained locally under `.local/`, excluded from Git.

This is focused verification, not exhaustive accessibility certification or a frame-rate benchmark. Arbitrary dragging, every keyboard path, multi-monitor DPI transitions, cloud-sync races and multi-hour sessions remain outside this test record.

## Migration and boundaries

See [MIGRATION.md](MIGRATION.md) for schemas, backup behavior, package limits and recovery. Existing notes are adopted without relocation or rewriting. Rename and **Assign to Neuron** preserve IDs and physical paths; physical subject relocation is not implemented. Legacy global review records are retained and copied into subject-scoped schedules without changing their scheduling fields.

- Attachments are preserved in transfers; local media rendering and remote fetching are not added.
- WikiLink heading fragments retain their text and resolve the note, but do not scroll to the heading.
- Camera and graph positions are retained within a session, not across process restarts.
- Metadata and note replacement use optimistic revision checks, not a cross-application locking protocol.
- Import publication becomes non-cancellable after its durable journal is written; recovery runs before subsequent snapshots.
- The scheduler remains the documented deterministic SM-2-inspired algorithm.
- GitHub Actions runs unit/static checks and installer generation. Local results do not imply that a hosted CI run has completed.

Final executable SHA-256: `46c0e3f939a1fca9521adc10093dc1e796921e7ebfcffc42c60b8867d2cef979`.

Final NSIS installer SHA-256: `f9192fad648ecb4cccc54d900558b8e1e0247bdbb2a0c0685c85fc29bd809bae`.
