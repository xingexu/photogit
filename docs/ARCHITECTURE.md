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

The Photoshop panel intentionally contains no Git implementation. It reads Photoshop state, exports artifacts, and delegates filesystem and repository operations to the helper. Requests and responses use ready markers under the Git-ignored `.photogit/bridge/` directory, avoiding plain HTTP—which Photoshop UXP restricts on macOS. Every request carries the project pairing token and the helper accepts only explicitly approved roots. The CLI composes the same packages and remains a complete fallback surface.
