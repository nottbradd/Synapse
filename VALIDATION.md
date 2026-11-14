# Validation record

Executed on Windows x64 on 14 November 2026 (Australia/Sydney). All data used for desktop tests was synthetic and remained in ignored `.local/` directories.

## Automated checks

| Check                                                     | Result                     |
| --------------------------------------------------------- | -------------------------- |
| TypeScript `npm run typecheck`                            | Passed                     |
| ESLint `npm run lint`                                     | Passed                     |
| Vitest `npm test`                                         | 5 tests passed             |
| Rust `cargo test --locked`                                | 7 tests passed             |
| Rust `cargo fmt --check`                                  | Passed                     |
| Rust `cargo clippy --locked --all-targets -- -D warnings` | Passed                     |
| `npm audit`                                               | 0 vulnerabilities reported |
| Vite production build                                     | Passed                     |
| Tauri Windows production build and NSIS packaging         | Passed                     |
| Staged-file exclusions and credential-pattern scan        | Passed                     |

Rust coverage includes YAML parsing, subject precedence, duplicate-name resolution, explicit root WikiLinks, code exclusion, card extraction and identity, rating intervals, metadata round trips, malformed metadata preservation, Unicode paths, traversal and junction containment, no-clobber creation, conflict preservation, and a 500-note index.

The frontend build emits a size advisory for its approximately 1.46 MB uncompressed JavaScript bundle (approximately 474 KB compressed). Assets are embedded in the executable; no network fetch is needed to load them. The installer is about 3.7 MiB and is unsigned. Installer generation was verified; running the installation wizard was not part of the test.

## Desktop integration

The scripts in `scripts/` attach to the actual Tauri WebView2 process. They use real Rust commands, filesystem watchers, and disk persistence. There is no mock vault or substitute persistence layer.

`desktop-smoke.mjs` passed on the desktop application:

- Restore and index the six-note synthetic fixture.
- Create a seventh note through the interface and compare saved bytes with the editor buffer.
- Render inline and display KaTeX mathematics.
- Update graph links after saving and use keyboard WikiLink autocomplete.
- Protect unsaved edits during navigation.
- Modify a file outside Synapse; resolve the conflict by keeping local edits, save, and inspect disk contents.
- Refresh a clean editor after an external change.
- Toggle subjects and search notes.
- Reveal and rate a card; read back `flashcards.json`, verify a future due timestamp, and reload the application.

`desktop-extended.mjs` passed on the packaged application:

- Click a painted graph node and verify the source note opens.
- Rate a card Again, verify it leaves the due queue, wait through the real 60-second delay, and verify it reappears in the same session.
- Rate that card Good and verify the subject completion state.
- Open a generated 500-note, 500-edge vault, then use fit, zoom, reset, search, and the editor.

`desktop-offline.mjs` passed after terminating and restarting the packaged executable:

- Restore the selected vault and previously saved review history across a process restart.
- Enable Chromium's offline network emulation and reload the production `http://tauri.localhost/` page successfully.
- Open a note, render mathematics, edit, and save while offline.
- Request native window closure with unsaved edits, verify the protection dialog, cancel, and save.
- Reveal and rate a card offline and verify persisted data.

Offline testing used WebView2 network emulation. It did not change Windows adapter settings or physically disconnect the computer.

## Visual and manual inspection

The native desktop window, polished first-launch state, and native Windows folder picker were visually checked. The native automation helper did not reliably target the picker child controls, so selecting a folder through that dialog was not completed by the helper. Subsequent vault selection was exercised through the real `open_vault` command in the desktop harness. This distinction is intentional: the entire native-picker interaction is not claimed as manually passed.

Desktop screenshots were inspected for sidebar layout, subject colors, graph spacing, editor/preview division, mathematics, and status placement. The 500-note graph was exercised by automation; no frame-rate benchmark is claimed. Hover behavior, arbitrary drag gestures, every keyboard focus path, and long multi-hour sessions have not received exhaustive manual coverage.

## Measured dataset

The Rust regression fixture contains **500 notes, 500 unique edges, and 500 cards**. Observed debug scan runs took **452–710 ms**. The packaged desktop's measured `open_vault` call took **1,554 ms** on the final build (**2,365 ms** during a concurrent release build), including filesystem scanning, watcher setup, configuration persistence, and IPC. These are individual local observations on this machine and OneDrive-backed workspace, not hardware-independent performance guarantees.

## Practical boundaries

- Conflict detection is optimistic. An unrelated process can race the final atomic replacement; there is no cross-application lock protocol.
- WikiLink heading fragments resolve the note but do not scroll to the heading.
- Graph positions and camera state persist during the session, not across process restarts.
- Local image attachments and external-site launching are not implemented. Notes cannot execute HTML/scripts or fetch remote images.
- The scheduler is a documented deterministic SM-2-inspired implementation, not FSRS.
- GitHub Actions contains Windows unit/static checks and installer generation. Local desktop integration results above do not imply that a GitHub-hosted CI run has completed.

Final tested executable SHA-256: `562cd0355b2bd89fed54935843b993db929449117c014ee143f22ab4ed38ef2e`.
Final NSIS installer SHA-256: `b5fb8ad2dcd7d4c221c93974d1eb39886490c152ba440df2a1991acae476a3bc`.
