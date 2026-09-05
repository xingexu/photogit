# Changelog

## 0.2.0 — unreleased development

Hardening candidate for the Photoshop version workflow. This entry describes changes under verification, not a declaration of release acceptance.

- Redesign the actual monochrome UXP panel around the supplied Pg logo and consistent version/project/document/scan language.
- Add document binding and scan lifecycle handling so stale or wrong-document scans cannot silently replace a project.
- Run imaging capture in Photoshop's required modal scope and preserve alpha. After direct group imaging failed natively, add a document-composite fallback with explicit old-baseline warnings; unrelated imaging failures still stop the scan. Add regressions based on both host failures.
- Raise the declared Photoshop floor to 25.0.0; native workflow testing uses 27.10.0, and lower versions remain unverified.
- Harden request claiming, singleton configuration locking, bounded bridge results, timeout cleanup, and partial-operation recovery reporting.
- Validate PhotoGit project structure in doctor instead of accepting an ordinary Git repository.
- Add version details and safe PSD extraction, semantic/file comparisons, explicit review bases, and conservative Git merge behavior.
- Replace source-string UI assertions with panel behavior tests and broaden filesystem bridge integration tests.
- Align product versions; add CI, Dependabot, issue/PR templates, a verified private reporting contact, and checked development packaging.
- Replace stale compatibility, screenshot, test-count, and release-date claims with an evidence ledger and explicit host gates.
- Remove thirteen unreferenced duplicate legacy PNG aliases with a recoverable local backup; preserve originals and current runtime icons. See [asset cleanup](docs/ASSET_CLEANUP.md).

See [ACCEPTANCE_REPORT.md](docs/ACCEPTANCE_REPORT.md) for actual results and [LIVE_ACCEPTANCE.md](docs/LIVE_ACCEPTANCE.md) for native-host checks. Public CCX distribution and automatic Photoshop semantic merging are not included.

## Earlier development revisions

The repository previously mixed package version 0.1.0 with plugin manifest 0.1.6. Existing artwork and demo media are retained as historical development artifacts; their names are not current product-version declarations.
