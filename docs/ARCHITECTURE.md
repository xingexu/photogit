# Architecture

PhotoGit separates supported design decisions into deterministic semantic domains. Git records those files; the PSD remains the exact visual artifact and fallback for unsupported Photoshop behavior.

```text
Photoshop panel -> authenticated project-folder bridge -> desktop helper -> Git
       |                                                        |
       +------ active-document capture                          +-- atomic project writes

CLI -----------------------------------------------------> Git + same core packages
```

## Packages

- `schema`: versioned semantic model, validators, and future migrations
- `serializer`: canonical JSON and domain-split project materialization
- `differ`: property-level, human-readable changes
- `merge-engine`: deterministic BASE/OURS/THEIRS merge planning
- `git-engine`: safe system-Git adapter, locks, and transactions
- `protocol`: versioned helper request and response contracts

The Photoshop panel intentionally contains no Git implementation. It reads Photoshop state, exports artifacts, and delegates filesystem and repository operations to the helper. Requests and responses use ready markers under the Git-ignored `.photogit/bridge/` directory. Every request carries the project pairing token and the helper accepts only approved roots. Loopback HTTP exists for CLI health and API tests, but is not the Photoshop transport. The CLI shares core packages; it cannot capture or open Photoshop documents by itself.

The helper serializes project requests, atomically claims bridge work, and locks each helper configuration. Results distinguish pre-mutation errors from operations that changed Git and still need a PSD opened or recovery. The panel must refresh project state after a partial failure. Request cancellation means a caller may stop waiting; it is not proof that a Git operation was rolled back.

The saved HEAD state is the comparison baseline. A document binding prevents a different active PSD from silently becoming the project snapshot. An explicit reconnect/adopt decision is required when identity differs. Unsupported appearance data remains authoritative in the PSD.

Capture fingerprints supported layers and the rendered document with a 64-pixel target sample, preserving alpha. Groups skip unsupported direct imaging; their visible appearance contributes to the document composite. An explicitly unsupported opaque-layer read can use that composite, while unrelated imaging errors invalidate the scan. Legacy versions without a composite receive a coverage warning rather than a synthetic document edit.

Layer reads run in batches of four inside Photoshop's modal scope. The queue checks a 30-second budget between batches; this cannot impose a hard deadline on an already-running host API call, and the final composite read has no separate forced timeout. Cancellation invalidates the generation and prevents stale results from being applied once control returns.

The merge-engine package plans semantic metadata merges in isolation. The Photoshop workflow performs conservative ordinary Git merges; it does not apply that plan to reconstruct Photoshop content. History extraction produces separate incoming files so inspecting an earlier version does not mutate HEAD.
