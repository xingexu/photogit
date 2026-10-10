# Tech stack

PhotoGit is version control for Photoshop documents that designers can read. It turns a PSD into small, per-layer text files and stores them in ordinary Git, so a version history says "the headline's opacity went from 100 to 80" instead of "binary file changed".

This page is the short tour of what it is built from and why.

## At a glance

| Layer | Technology | Why this choice |
| --- | --- | --- |
| Photoshop panel | Adobe UXP (manifest v5), plain JavaScript, HTML, CSS | Runs inside Photoshop 25+ with no framework or bundler to ship or audit |
| Desktop helper | Node.js 22+, TypeScript | The only process allowed to touch Git and the filesystem |
| Core packages | TypeScript, no third-party runtime dependencies | Deterministic, testable logic shared by the helper and the CLI |
| Version storage | System Git 2.40+, Git LFS for `*.psd` / `*.psb` | Every version is a real commit; push, pull and GitHub work unchanged |
| Query database | PostgreSQL 14 | Relational mirror of the layer model for reporting and search |
| Command line | Node.js CLI on the same core packages | Scriptable setup and diagnostics without Photoshop |
| Landing page | Static HTML, CSS and JavaScript on Vercel | No build step |
| Tests | Vitest, Node's built-in test runner, linkedom | Unit, integration and DOM-contract checks without a browser |
| CI | GitHub Actions on Linux and macOS, Node 22 and 24 | Every push is type-checked, built, tested and security-verified |
| Asset tooling | Swift, Python and shell scripts | Renders icons, previews, the demo video and the landing-page audio |

By size the repository is roughly 54% TypeScript, 33% JavaScript, 7% HTML, 5% CSS and 1% Swift.

## How the pieces fit

```text
Photoshop panel -> paired project-folder bridge -> desktop helper -> Git (+ LFS)
       |                                                 |
       +-- reads the open document                       +-- atomic project writes

CLI ------------------------------------------------> same core packages -> Git
```

The panel reads Photoshop state and never runs Git. It hands requests to the helper through a Git-ignored bridge folder, and each request carries a pairing token that the helper checks against its approved project roots. Keeping Git out of the panel is the main security boundary of the product.

## Core packages

| Package | Job |
| --- | --- |
| `schema` | The versioned model of a document, plus validators with hard size limits |
| `serializer` | Writes that model as canonical JSON, one file per layer and domain |
| `differ` | Produces property-level, human-readable changes |
| `merge-engine` | Plans three-way merges of layer metadata deterministically |
| `git-engine` | Wraps system Git with locks and transactions |
| `protocol` | Versioned request and response contracts between panel and helper |

Splitting a document into one file per layer and per domain (structure, appearance, text, content) is what lets Git merge two people's edits to different layers without a conflict.

## Database

The semantic model also has a PostgreSQL form in [`db/schema.sql`](../db/schema.sql). Git remains the source of truth; the database holds project state in seven tables so it can be queried with SQL.

| Table | Holds |
| --- | --- |
| `projects` | Project identity and display name |
| `documents` | Canvas size, resolution, colour mode, compatibility warnings |
| `layers` | The layer tree: name, kind, order, parent |
| `layer_identities` | How confidently each layer was matched across versions |
| `layer_appearance` | Visibility, opacity, blend mode, locks, bounds |
| `layer_text` | Text contents and style fingerprint |
| `layer_content` | Pixel fingerprint and captured layer details |

The column limits and ranges match the validators in `packages/schema`. To load it locally:

```sh
createdb photogit
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/schema.sql
```

`.env.example` carries the connection string used in development. Nothing in the helper, CLI or panel reads or writes the database yet.

## Quality and security

- TypeScript project references, checked with `tsc -b` on every change.
- Focused Vitest suites per package and per panel view, each reported as its own check.
- Scripted gates for HTML escaping in the panel, design tokens, the panel DOM contract, asset stamps and the packaged bundle.
- No third-party runtime dependencies in the core packages; development dependencies are watched by Dependabot.
- Native Photoshop behaviour is covered by a separate live acceptance matrix, because mocked tests cannot prove it.

## Status

Version 0.2.0 is a development build. It is packaged as a source bundle rather than an installable plugin, and merging uses ordinary Git with PSD conflict checks rather than automatic layer blending.
