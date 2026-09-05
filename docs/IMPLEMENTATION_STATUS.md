# Implementation status: 0.2.0 development

This revision is a hardening candidate, not a completed v1. The [acceptance report](ACCEPTANCE_REPORT.md) is the source of truth for commands and host checks actually run. Past acceptance prose and historical screenshots do not establish current behavior.

## Implemented surfaces

- Deterministic schema and serializer, layer diff model, and a standalone semantic merge planner.
- Git-backed versions, project locks, bounded state reads, transaction recovery, branch comparisons, history details, and extraction of earlier PSDs into separate working files.
- CLI initialization, project doctor, save, status, diff, and history.
- Approved-root helper, token-authenticated filesystem bridge, request claiming, per-configuration locking, bounded responses, redaction, and project-document binding.
- Actual UXP panel for connection, scanning, versions, branches, reviews, and activity. Common edit detection, saved baselines, separate history opening, branch switching, clean/blocked merges, wrong-document protection, and helper reconnect were exercised in Photoshop 27.10.0.
- One product version across package metadata and manifest, CI configuration, source secret inventory, development archive verification, and contributor/security guidance.

## Deliberate feature boundaries

- A **version** is stored as a Git commit; the UI uses “version”.
- A **scan** compares the connected Photoshop document against saved state; externally edited metadata is not an implicit new baseline.
- **Git merge** is ordinary Git merging. Semantic merge planning is not applied to PSD content.
- **Open GitHub comparison** opens a provider URL; it does not create a draft pull request.
- **View conflicts** explains conflicting paths; it does not imply automatic PSD conflict resolution.
- Earlier-version PSDs are opened separately. Restoration requires inspecting the copy and deliberately saving the intended state as a new version.
- `demo.html` and simulated DOM tests are prototypes or test harnesses. Neither proves UXP imaging or Photoshop transitions.

## Release gates

The final integrated suite passed 210 tests in 15 files, including 78 production panel behavioral tests and 13 actual helper-process bridge tests. Check, build, source security inventory, and development package verification passed. The earlier online audit found zero vulnerabilities with the unchanged dependency lock; authorization to repeat that external audit was denied. The native group-opacity/document-composite follow-up passed with a new saved baseline and no legacy warning or false dirty state. A 521-layer native document scanned successfully with correct 500-of-548 list truncation. Six native panel images were inspected at 420 × 800 logical pixels with 2× raster output. These observations do not complete every host scenario or the requested visual matrix; the final Save-control reorder has an automated regression but was not reverified natively.

The native debugger stopped responding during an attempted cancellation stress test. Its outcome was not observed, and large-document saving was not run. Photoshop and the test artwork were left open; restarting the host requires user permission after saving personal work. Fresh folder selection/permission, shape/mask/effect/smart-object cases and additional group effects, large-document save/cancellation, remaining native failure/timeout combinations, the full panel size/scale/state matrix, clean-machine installation, signed packaging, other Photoshop/OS versions, and Adobe distribution identity remain open. See [the evidence ledger](ACCEPTANCE_REPORT.md), [LIVE_ACCEPTANCE.md](LIVE_ACCEPTANCE.md), and [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md).

No release date is promised by this repository. Only the scoped native images under `artifacts/acceptance-20260904/` are current visual evidence; other media remain historical material.
