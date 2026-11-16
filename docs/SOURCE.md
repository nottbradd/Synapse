# Release source and rebuilding

Each Windows release is accompanied by `Synapse-VERSION-source.zip` and a matching Git tag. This contains the application and gateway source, original artwork and sound synthesis, lockfiles, configuration, tests, license notices, and build scripts. The public repository provides the same source under GNU GPL version 3 only. The desktop has no signing or activation restriction on modified local builds.

The adjacent `Synapse-VERSION-dependency-sources.zip` contains unmodified registry archives for the production JavaScript packages and the Windows Rust dependency closure. Its manifest records versions, upstream repositories, licenses, download locations, and verified checksums. Some npm packages distribute generated JavaScript; the manifest also identifies their upstream repositories. Third-party software retains its own licenses. Full redistribution notices are included in the installer and in `THIRD_PARTY_NOTICES.txt`.

To build on Windows x64, install the prerequisites listed in the [README](../README.md): Node.js and npm, Rust with the MSVC toolchain, Visual Studio C++ Build Tools, Windows SDK, and WebView2. These are separate development/runtime prerequisites. Extract the project source and run:

```powershell
npm ci
npm ci --prefix backend/ai
npm run typecheck
npm test
cargo test --locked --manifest-path src-tauri/Cargo.toml

# Optional public gateway origin; contains no credential.
$env:SYNAPSE_AI_URL = 'https://synapse-ai.nottbradd.workers.dev'
npm run tauri build
```

Normal builds download the exact dependencies specified by the lockfiles. Registry archives in the dependency source archive can be inspected with `tar`; Cargo `.crate` files are gzip-compressed tar archives. Installer generation also obtains Tauri's NSIS toolchain and WebView2 bootstrapper when not cached. Build output is in `src-tauri/target/release`, with the installer under `bundle/nsis`.

No private API key, invitation, owner account or owner configuration is necessary to compile and run the local features. A build with the public gateway URL still requires a valid invitation to use hosted AI. The optional gateway can be deployed separately using the [owner guide](../backend/ai/README.md); deployment is not part of a desktop build. Source access does not grant service credentials, funding or invitations.

The release is unsigned. Compiler, operating-system and packaging timestamps can change binary hashes; these instructions do not claim byte-for-byte reproducible binaries. The published installer checksum identifies the tested artifact.
