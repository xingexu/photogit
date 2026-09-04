# Implementation status

## Implemented in the first vertical slice

- Production monorepo shape and TypeScript project boundaries
- Semantic schema v1 and deterministic canonical JSON
- Domain files for document metadata, layer structure, appearance, and text
- Bounded runtime validation for nested captures, saved state, relationships, and filename-safe layer identities
- Property-level diff model with mergeability and confidence fields
- Three-way merge planner for independent edits, UUID-keyed layer records, and same-property conflicts
- Git subprocess isolation using argument arrays
- Atomic file replacement, validated transaction journals, stale lock recovery, and real-path/symlink containment
- CLI initialization, save-version, status, history, and semantic diff
- Token-authenticated, Git-ignored project-folder bridge compatible with Photoshop on macOS
- UXP panel document and nested-layer capture
- VIT-style panel loop with Pull, Push, Status, activity, branches, semantic refresh, Save version, clickable layer changes, and history
- Automatic helper pairing through a mode-0600, Git-ignored project file
- Git LFS 3.8.0 installed and initialized for the local demo project
- Responsive monochrome panel UI with one outer scroll, persistent section/sync navigation, flat history/review rows, reduced-motion/transparency modes, keyboard menus, focus trapping, and bounded text fields
- 78 automated checks covering schema and capture bounds, canonical output, identity reconciliation, diffs, UUID-aware merge planning, traversal and symlink safety, rollback and forged journals, helper configuration and credential redaction, the authenticated bridge envelope, the UXP UI/manifest/icon contracts, and complete temporary-repository CLI flows

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
