# PhotoGit

**Faster navigation:** click **Commands**, or browse the new **Docs** tab. Type `/history`, `/save Refined title` (`/commit` alias), or `/merge cover-b`, then press Enter. See the [command directory](docs/COMMANDS.md) for syntax and safety behavior.

PhotoGit records Photoshop documents as named versions in a local Git project. A version includes supported layer metadata and an exact PSD; Git LFS stores large PSD and preview artifacts. The Photoshop panel talks to a local helper through an authenticated project-folder bridge.

**0.2.0 is an unreleased development build.** It is not a completed v1 release. Keep an independent copy of valuable artwork. See the [acceptance report](docs/ACCEPTANCE_REPORT.md) for checks performed on this revision and the real Photoshop checks still required.

## Get started

Use Node.js 22 or newer, Git 2.40 or newer, Git LFS, Photoshop, and Adobe UXP Developer Tools. The manifest declares Photoshop 25.0.0 or newer; native workflow testing in this work used Photoshop 27.10.0. See the [compatibility table](docs/COMPATIBILITY.md) for the declared floor versus tested environments.

```sh
npm ci
npm run build
npm run photogit -- init /absolute/path/to/design-project
npm run helper -- --approve-root /absolute/path/to/design-project
```

Leave the helper running. Load `apps/photoshop-plugin/manifest.json` in UXP Developer Tools, then open **Plugins → PhotoGit → PhotoGit** in Photoshop. Choose the initialized project folder and connect the intended document. Setup, Git identity, pairing, and troubleshooting are in the [quick start](docs/QUICK_START.md).

Photoshop controls panel placement. Drag the PhotoGit panel tab into the desired dock yourself; use Photoshop's workspace controls to preserve the layout. PhotoGit cannot automatically dock itself beside the tools.

## Workflow and limits

Edit the connected document, scan its supported layer changes, and save a named version. History exposes saved work; branches represent alternate design directions; reviews compare branch changes. Operations that open a saved PSD open a separate document rather than silently overwriting the existing open document.

The PSD is the authoritative visual artifact. Rendered fingerprints use 64-pixel samples, so they can miss tiny edits and cannot always identify whether paint, masks, effects, shapes, or smart-object content caused a change. PhotoGit's semantic merge planner is a library, not an automatic Photoshop layer application engine. User-facing branch merging is an ordinary Git merge with conservative PSD conflict checks. It does not reconstruct a PSD by combining semantic JSON.

The helper is required for panel repository actions. Project-folder access alone does not start it. The [architecture](docs/ARCHITECTURE.md), [implementation status](docs/IMPLEMENTATION_STATUS.md), and [security policy](SECURITY.md) explain current boundaries.

## Verified native workflow

In Photoshop 27.10.0, the actual panel detected common edits automatically, saved versions with a clean baseline, opened earlier PSDs separately, switched branches, completed a clean Git merge, blocked a conflicting merge, rejected a wrong-document save, and recovered after helper restart. Group-opacity detection also passed through the document-composite fallback after direct group imaging failed. A 521-layer scan correctly displayed 500 of 548 changes. The command-directory follow-up passed 245 tests; native checks verified the palette, `/docs` navigation, and rejection of `/merge` without an argument. Native large-document save/cancellation, fresh folder permission, unrecorded advanced layer cases, and the complete native size/scale matrix remain open. [Full evidence and limitations](docs/ACCEPTANCE_REPORT.md).

[View the real Changes panel](artifacts/acceptance-20260904/native-changes.png), captured at 420 × 800 logical pixels with 2× raster output. Captures predate the final Save-control placement adjustment, which remains unverified natively. This single size does not establish the full responsive matrix.

## Verify and package locally

```sh
npm run check
npm run build
npm test
npm run verify:security
npm audit
npm run package:development
npm run verify:package
```

The archive `release/photogit-0.2.0-development.zip` is a checked source bundle for UXP Developer Tools. It is **not** a signed or installable `.ccx`, and does not contain a packaged helper installer. The manifest retains `com.photogit.development`; public distribution needs Adobe's permanent plugin ID and separate installation testing.

## Demonstrations

`apps/photoshop-plugin/demo.html` visibly identifies itself as a simulated UI prototype. Native evidence is scoped in `artifacts/acceptance-20260904/` and the later `artifacts/commands-20260905/`. Other screenshots and videos are historical development material, not current acceptance evidence. See [live acceptance](docs/LIVE_ACCEPTANCE.md).

[Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md) · [Release checklist](docs/RELEASE_CHECKLIST.md)
