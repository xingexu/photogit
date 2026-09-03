# Implementation status

## Implemented in the first vertical slice

- Production monorepo shape and TypeScript project boundaries
- Semantic schema v1 and deterministic canonical JSON
- Domain files for document metadata, layer structure, appearance, and text
- Runtime validation that rejects unsafe or malformed captures
- Property-level diff model with mergeability and confidence fields
- Three-way merge planner for independent edits and same-property conflicts
- Git subprocess isolation using argument arrays
- Atomic file replacement, transaction journals, and stale lock recovery
- CLI initialization, save-version, status, history, and semantic diff
- Token-authenticated, Git-ignored project-folder bridge compatible with Photoshop on macOS
- UXP panel document and nested-layer capture
- VIT-style panel loop with Pull, Push, Status, activity, branches, semantic refresh, Save version, clickable layer changes, and history
- Automatic helper pairing through a mode-0600, Git-ignored project file
- Git LFS 3.8.0 installed and initialized for the local demo project
- 19 automated checks covering schema, canonical output, identity reconciliation, diffs, merge planning, path/branch safety, rollback, the authenticated bridge envelope, the UXP manifest, and a complete temporary-repository CLI flow

## Requires local Adobe/account access

- Permanent Developer Distribution plugin ID
- Photoshop 2025 compatibility test (Photoshop 2026 is verified)
- `.ccx` packaging and Creative Cloud installation test
- Marketplace listing, screenshots, and submission
- Apple signing/notarization credentials for a native helper installer

## Live acceptance test completed

On September 3, 2026, PhotoGit was loaded through Adobe UXP Developer Tools 2.2.1 into Photoshop 2026 v27.10. The panel paired with an approved project folder, detected semantic layer and document changes, saved PSD and PNG artifacts through Git LFS, displayed history, created and switched branches, pushed and pulled a shared branch, reopened branch-specific PSD state, and reported a clean project.

## Release gates still open

Applying individual semantic changes back into an already-open document, visual compare, interactive conflict resolution, distributable packaging, website, complete user documentation, Photoshop 2025 coverage, and clean-machine acceptance testing.
