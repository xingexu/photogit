# Security policy

PhotoGit is not yet production-ready. Do not use it as the only copy of valuable artwork.

Report vulnerabilities privately to the project maintainer rather than opening a public issue. Until a dedicated security address is configured, use GitHub private vulnerability reporting on the repository.

The helper binds only to `127.0.0.1`, rejects non-loopback host headers and browser-origin POSTs, and authenticates every request with a random project token. It restricts operations to explicitly approved, real-path-resolved roots; refuses symlinked state and bridge files; bounds request, response, and state-file sizes by UTF-8 bytes; keeps bridge directories owner-only; and writes pairing data atomically with mode `0600`. It refuses to replace a pairing file tracked by Git, never returns a raw remote URL to the Photoshop panel, and redacts helper tokens plus credentials embedded in error URLs.

Capture and project schemas validate nested values, relationships, sibling order, layer counts, filename-safe UUIDs, and bounded text before any state is serialized. Repository operations use argument arrays rather than shell interpolation, validate branch/tag/path inputs, keep transactions on an explicit allowlist of semantic and snapshot paths, stage those exact paths instead of the entire metadata directory, and recover through validated transaction journals. Credentials belong in the operating-system credential manager or an existing Git credential helper and must never be written to a PhotoGit project.
