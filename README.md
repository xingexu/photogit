<div align="center">

<img src="apps/photoshop-plugin/icons/photogit.png" alt="PhotoGit logo" width="96">

# PhotoGit

**Version control for Photoshop.**<br>
Save exact PSD versions, see what changed layer by layer, and explore branches, all from a panel inside Photoshop.

[![CI](https://github.com/xingexu/photogit/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/xingexu/photogit/actions/workflows/ci.yml)
[![Version](https://img.shields.io/badge/version-0.2.0%20development-orange)](CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A5%2022-339933?logo=node.js&logoColor=white)](docs/DEVELOPMENT.md)
[![Photoshop](https://img.shields.io/badge/Photoshop-25%2B-31A8FF?logo=adobephotoshop&logoColor=white)](docs/COMPATIBILITY.md)

[Website](https://photogit-three.vercel.app/) · [Quick start](docs/QUICK_START.md) · [Commands](docs/COMMANDS.md) · [Architecture](docs/ARCHITECTURE.md) · [Changelog](CHANGELOG.md)

</div>

> [!WARNING]
> **Development build (0.2.0), not a production release.** Keep independent backups of valuable artwork.

## The panel

<table>
  <tr>
    <td width="33%"><img src="artifacts/readme/panel-history.png" alt="History tab listing saved versions, with Compare and Restore on the selected one"></td>
    <td width="33%"><img src="artifacts/readme/panel-branches.png" alt="Branches tab showing each branch with its latest saved version"></td>
    <td width="33%"><img src="artifacts/readme/panel-reviews.png" alt="Reviews tab showing branches waiting to merge and their conflicts"></td>
  </tr>
  <tr>
    <td align="center"><b>History</b><br>Every saved version, with a preview. Compare any of them with the open document, or restore it as a separate copy.</td>
    <td align="center"><b>Branches</b><br>Try an alternative without losing the original. Each branch shows the last version saved on it.</td>
    <td align="center"><b>Reviews</b><br>See which branches are ready to merge and which have conflicts to settle first.</td>
  </tr>
</table>

## What it does

- **Tracks edits as you work.** The Changes tab lists unsaved edits by layer: pixels, text, opacity, blend mode, order, and more.
- **Saves exact versions.** Each version stores the full PSD alongside a readable description of every layer, so you can always open precisely what you saved.
- **Explains what changed.** History shows previews, before/after comparisons, and which layers were added, deleted, or edited.
- **Branches like Git, because it is Git.** Every version is a Git commit, so push, pull, and GitHub work as usual.
- **Keeps Git out of the panel.** A local helper is the only process that runs Git; the panel talks to it over a paired, Git-ignored bridge.

Want a look before installing anything? Visit the [website](https://photogit-three.vercel.app/), or open `apps/photoshop-plugin/demo.html` for a simulated panel.

## How it works

PhotoGit serializes your Photoshop document into a domain-split JSON tree under `.photogit/`, instead of versioning the raw PSD as one opaque blob:

| File | Contents | Panel filter |
| --- | --- | --- |
| `document.json` | Canvas size, resolution, color mode, compatibility warnings | — |
| `structure/layers.json` | Layer tree — names, order, parent/child relationships, kind | Structure |
| `appearance/<layer>.json` | Visibility, opacity, blend mode, locks, bounds (one file per layer) | Visual |
| `text/<layer>.json` | Text contents and style fingerprint (text layers only) | Text |
| `content/<layer>.json` | Pixel/raster content fingerprint (one file per layer) | Visual |
| `identities.json` | Tracks each layer's identity across renames/reorders, with a confidence score | — |
| `project.json` | Project-level PhotoGit configuration | — |

Splitting layer data into one JSON file per layer, by domain, means Git can merge edits to different layers — or different properties of the same layer — without conflicting. Edits to the same property of the same layer still need a manual merge decision, same as any other Git conflict.

Change detection checks full-resolution rendered pixels and supported metadata, including brush and eraser edits. Older saved versions retain thumbnail-based comparison until you save a new version to establish the full-resolution baseline. Unsupported layer internals can still require manual review. History shows saved previews, before/after comparisons, and added, deleted, or edited layers. Merging uses ordinary Git with PSD conflict checks — not automatic Photoshop layer blending.

## Installation

Requirements: Node.js 22+, Git 2.40+, Git LFS, Photoshop, and Adobe UXP Developer Tools. Photoshop 25+ is declared; native testing used 27.10.0. See [compatibility details](docs/COMPATIBILITY.md).

```sh
git clone https://github.com/xingexu/photogit.git
cd photogit
npm ci
npm run build
```

There's no published package yet — running `npm run photogit -- ...` and `npm run helper -- ...` from this checkout is the only supported way to use the CLI and helper.

## Using the panel

The main way to use PhotoGit is through the panel inside Photoshop. You only need the terminal for one-time project setup.

**One-time setup (Terminal)**

```sh
npm run photogit -- init /absolute/path/to/design-project
npm run helper -- --approve-root /absolute/path/to/design-project
```

Keep the helper running — it's the only process with Git access; the panel talks to it over a paired, Git-ignored bridge and never runs Git itself. Then load `apps/photoshop-plugin/manifest.json` in UXP Developer Tools and open **Plugins → PhotoGit → PhotoGit** in Photoshop. Choose your initialized project folder and connect the intended document.

For pairing, Git identity, and troubleshooting, see the [setup guide](docs/QUICK_START.md).

**Daily workflow (entirely in the panel)**

- **Changes** — scan edits and save a named version
- **History** — inspect versions and open saved PSDs as separate documents
- **Branches & Reviews** — explore alternatives, compare changes, and merge when safe
- **Commands & Docs** — drive everything above from a fixed command dispatcher (never arbitrary code), and browse the [command directory](docs/COMMANDS.md)

## Commands

Type `/` or <kbd>⌘</kbd><kbd>K</kbd> anywhere in the panel to open the command palette.

<details>
<summary><b>All commands</b></summary>

| Command | Result |
| --- | --- |
| `/changes`, `/history`, `/branches`, `/reviews`, `/activity`, `/docs` | Navigate to that section |
| `/scan` | Scan the connected document for edits |
| `/save Refined title` (or `/commit`) | Save an exact PSD version with that message |
| `/branch cover-b` | Create and switch to a new branch |
| `/switch cover-b` | Switch to a branch and open its saved PSD |
| `/compare cover-b` | Show semantic and file differences against the current branch |
| `/merge cover-b` | Review the comparison and confirm an ordinary Git merge (conflicts stay blocked) |
| `/tag` | Open the tag form |
| `/status` | Inspect project and helper information |
| `/connect` / `/reconnect` | Choose or retry the project's helper connection |
| `/conflicts` | View conflicting files |
| `/pull` / `/push` | Sync with the project's configured remote |

</details>

Full details, including message-length limits, are in the [command directory](docs/COMMANDS.md).

## Project structure

```
photogit/
├── apps/
│   ├── desktop-helper/     # Local helper: the only process with Git access
│   └── photoshop-plugin/   # UXP panel UI — captures Photoshop state, no Git of its own
├── cli/                    # Terminal entry point (init, doctor, ...)
├── packages/
│   ├── schema/             # Versioned semantic model + validators
│   ├── serializer/         # Photoshop state -> domain-split JSON
│   ├── differ/             # Property-level diffs
│   ├── merge-engine/       # Deterministic BASE/OURS/THEIRS merge planning
│   ├── git-engine/         # Safe system-Git adapter (locks, transactions)
│   └── protocol/           # Versioned helper request/response contracts
├── site/                   # Marketing landing page
├── artifacts/              # Design/preview assets
├── scripts/                # Verification, packaging, and demo scripts
└── docs/                   # Architecture, commands, setup, and acceptance docs
```

## Testing

```sh
npm run check
npm test
npm run verify:security
npm run verify:tokens
npm run verify:panel-dom
npm run verify:panel-escaping
npm run verify:assets
npm run package:development
npm run verify:package
```

Each area also has its own focused script — `npm run test:panel-depth`, `npm run test:helper`, `npm run test:engine`, `npm run test:serializer`, and so on — and each runs as its own CI check, so a failure names the functionality rather than the run.

Packaging produces `release/photogit-0.2.0-development.zip`, a development source bundle — not an installable `.ccx` or helper installer. Open `apps/photoshop-plugin/demo.html` for a simulated UI preview.

## Contributing

PhotoGit is pre-release (0.2.0) — discuss large behavior or schema changes in an issue first. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guidelines, including:

- Live-Photoshop acceptance testing is required for UXP-facing changes ([docs/LIVE_ACCEPTANCE.md](docs/LIVE_ACCEPTANCE.md)) — mocked/browser tests alone don't prove Photoshop correctness
- Never add real artwork, credentials, tokens, or private document metadata to fixtures
- Repository settings, publishing, and merges require maintainer authorization

## Documentation

[Verification & known limitations](docs/ACCEPTANCE_REPORT.md) · [Architecture](docs/ARCHITECTURE.md) · [Tech stack](docs/TECH_STACK.md) · [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md) · [Release checklist](docs/RELEASE_CHECKLIST.md)

## License

[MIT](LICENSE)
