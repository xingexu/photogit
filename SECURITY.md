# Security policy

PhotoGit 0.2.0 is an unreleased development build. Keep an independent backup of valuable artwork. Automated checks do not establish that every Photoshop operation is safe.

Report vulnerabilities privately to [xxu767@uwo.ca](mailto:xxu767@uwo.ca), the maintainer's contact published on [xinge.ca](https://xinge.ca/). Use the subject “PhotoGit security report”. Include the affected revision, reproduction steps using synthetic data, impact, and any suggested fix. Do not send helper tokens, credentials, or private PSDs. This is ordinary email; encrypted reporting and a response-time guarantee are not currently provided.

GitHub private vulnerability reporting was **disabled** when checked on September 4, 2026. Do not rely on that feature until the repository settings and this policy are updated. Enabling it requires a separate maintainer action.

Only the current development branch is being maintained; there is no supported stable release series yet.

## Defensive boundaries

The helper binds only to `127.0.0.1`, rejects non-loopback host headers and browser-origin POSTs, and authenticates every request with a random project token. It restricts operations to explicitly approved, real-path-resolved roots; refuses symlinked state and bridge files; bounds request, response, and state-file sizes by UTF-8 bytes; keeps bridge directories owner-only; and writes pairing data atomically with mode `0600`. It refuses to replace a pairing file tracked by Git, never returns a raw remote URL to the Photoshop panel, and redacts helper tokens plus credentials embedded in error URLs.

Capture and project schemas validate nested values, relationships, sibling order, layer counts, filename-safe UUIDs, and bounded text before any state is serialized. Repository operations use argument arrays rather than shell interpolation, validate branch/tag/path inputs, keep transactions on an explicit allowlist of semantic and snapshot paths, stage those exact paths instead of the entire metadata directory, and recover through validated transaction journals. Credentials belong in the operating-system credential manager or an existing Git credential helper and must never be written to a PhotoGit project.

These controls are defenses, not a sandbox for untrusted Git repositories. Git configuration, hooks, filters, credential helpers, and executable dependencies can run under the user's account. Approve only projects you trust. The local pairing token is a bearer credential; other processes running as the same OS user can access it. Loopback HTTP health is informational and does not prove that the panel's filesystem bridge is paired.

## Verification

Run `npm audit`, `npm run verify:security`, and `npm test`. The secret inventory checks tracked and untracked non-ignored source files for known key/token forms without printing matching values; it does not inspect Git history or detect every possible credential. Tests cover authentication, containment, symlinks, malformed input, request/response bounds, rollback, and redaction. See [the acceptance report](docs/ACCEPTANCE_REPORT.md) for the evidence and live gaps for this build.
