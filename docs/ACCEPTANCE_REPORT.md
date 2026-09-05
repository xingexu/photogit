# Acceptance report: 0.2.0 development

## September 5 command-directory follow-up

Following commit `be82b52`, the UI was compacted and a 19-command palette and searchable Docs tab were added. Save/commit, branch, compare, merge, scan, history and sync commands reuse the existing guards; sync and switch require confirmation. Background native fields are hidden while overlays are open to prevent UXP placeholder bleed-through. The missing explicit `@1x` icon is now packaged.

The final follow-up run passed **245/245 tests in 15 files**, including **113 production panel behavior tests**. Type checks, build, source security inventory, package creation/verification and diff checks passed. The ZIP includes 11 runtime files; SHA-256 `5ef086235487aa04680ce551364260e9c7bfed0b51ec71a55636a8789ffd1ed2`. No dependency changes or new online audit were needed.

Native Photoshop 27.10.0 showed the compact Changes layout, the command palette, and successful `/docs` navigation at 420 × 800 logical pixels (2× capture backing). Native testing found Cmd+K intercepted by Photoshop Preferences and a replacement modifier shortcut unreliable, so neither is advertised or registered. Use the Commands button and type a command, then Enter. The background-placeholder fix was visually verified. Modifier shortcuts are not a claimed feature. These observations do not establish every native command mutation or the full size/scale matrix.

See [Commands](COMMANDS.md) and the new [palette capture](../artifacts/commands-20260905/palette.png). The original hardening ledger below is historical evidence, not the latest source revision or test count.

This ledger records the September 4–5, 2026 hardening session. Core workflows were exercised in real Photoshop, but fresh folder permission and the complete native size/scale/state matrix remain unverified. This is not a completed v1 acceptance claim.

## Source and baseline

| Item | Observed result |
| --- | --- |
| Starting and current source revision | `17dc4eef0823efbdefd0d77102cfcc6a072cada1` plus the local uncommitted hardening patch |
| Working branch | `codex/photogit-v1-hardening` |
| Runtime | Node 24.4.1, npm 11.4.2, Git 2.48.1, Git LFS 3.8.0 |
| Existing test suite | 82 tests passed when loopback access was available. |
| Existing check/build | Both passed. |
| Ordinary Git repository doctor | Reproduced failure: incorrectly reported a valid project without `.photogit`. |
| Existing UI tests | Source-string checks did not establish runtime behavior. |
| Existing helper integration | HTTP-only coverage did not establish filesystem bridge behavior. |

## Automated verification

| Command/check | Observed result |
| --- | --- |
| `npm test` | **210/210 tests passed in 15 files** in the final integrated run, including save-target races, adoption confirmation, missing-current-composite warnings, and Save controls preceding the changes list. The run began September 4 at 23:59:42 local time and finished around midnight September 5. |
| `npm run check` | Passed. |
| `npm run build` | Passed. |
| `npm run verify:security` | Passed: 94 text files checked, 22 binary files excluded in the final security run. Known-token/private-key/credential-URL rules print locations only; Git history and unknown secret forms are not scanned. |
| `npm audit --json` | Earlier online audit after the exact DOM test dependency was installed: 0 vulnerabilities, 145 dependency entries. The dependency lock has not changed since that successful audit. A requested final repeat was denied by the approval review because it would disclose dependency metadata to npm's external service; it was not bypassed. Authorization is required to repeat that network audit. |
| `npm run package:development` and `npm run verify:package` | Passed with 9 referenced runtime/manifest/icon files and one 0.2.0 product version. Final archive SHA-256: `dffee209771600a940948deabb1ffe444413402bb85d1d8c50be4536e974d365`. Verification checks extracted bytes, runtime syntax, and the built CLI. Any subsequent runtime edit requires rebuilding and re-verifying the archive. |
| Fresh `npm ci` | Passed in an isolated temporary directory with the root/workspace manifests and lockfile; 135 packages installed. This verifies dependency setup, not a clean-machine Photoshop installation. |
| Selected suite coverage | 78 production panel behavioral tests, 4 manifest checks, 13 real helper-process bridge tests, 10 schema tests, 22 differ tests, and 6 serializer tests are included in the passing integrated suite. The panel tests use explicit Photoshop/UXP mocks and a simulated DOM, with a modal-enforcing imaging mock. |
| Doctor | The actual valid native-test project exited 0. Ordinary Git repositories, malformed projects, invalid pairing, and ineffective ignore/LFS rules have automated rejection tests. |
| `git diff --check` | Passed for the reviewed patch. |
| CI configuration | Added Node 22/24 on Linux/macOS, audit, security inventory, and package verification. Local passes do not claim GitHub Actions has run. |

## Real Photoshop evidence

The actual PhotoGit panel ran in **Photoshop 2026, version 27.10.0** on macOS. The helper used its real filesystem bridge in `--bridge-only` mode with the isolated, ignored project `photogit-demo/.photogit/bridge/acceptance-20260904`. It reused an existing folder grant. **The native folder picker/permission flow was not verified with a fresh grant in this session.**

All short version IDs below belong to the disposable artwork project, not the PhotoGit source repository.

| Scenario | Native observation |
| --- | --- |
| Imaging failure reproduced and fixed | The first real scan exposed that `imaging.getPixels` required modal scope. Capture now runs in `core.executeAsModal`, with self-notification suppression. The subsequent real scan succeeded; a behavioral regression models that host rule. |
| First versions and automatic baseline reset | Saved first version `1447e0e4`, added-layer baseline `1b2cdc45`, and edited version `a2e0d793`. First/second saved baselines returned to zero. Native fractional-opacity handling also exposed a defect; it was fixed and the saved document's automatic scan returned to zero. |
| Editing and automatic detection | Added layer, rename, hide, reorder, text editing, painted pixels, movement, and opacity changes appeared through automatic detection. This does not establish every advanced layer feature or every possible pixel edit. |
| Layer deletion | Removing a layer was detected in the real panel. This observation does not establish every undo/recovery combination. |
| Group imaging failure and verified follow-up | Direct group imaging failed in real Photoshop. Capture now skips direct group reads and records a sampled whole-document composite alongside supported layer fingerprints. On `acceptance-groups`, baseline version `27a56609` saved successfully, returned to zero changes, and removed the old-baseline warning. Requesting group opacity 45 produced Photoshop's value `45.09803921568628`; the automatic scan showed the precise group opacity change plus “Document rendered appearance changed”. Final group version `6af81c8` saved successfully, leaving the artwork repository clean. This verifies the tested group-opacity/composite path, not every group mask/effect or tiny pixel edit. |
| History inspection/opening | Opening the first version created document 106 with two layers and “Version one”. Original document 81 remained open with three layers and “Version two”. Earlier work was opened separately, not overwritten. |
| Branch save and switch | Branch A saved `a9a0d5dd`. Switching to `master` opened the matching “Version two” PSD as document 114 and reported zero changes. |
| Clean ordinary Git merge | Merge `f61465a` opened the resulting “Branch A” PSD as document 117 and reported zero changes. This was an ordinary Git merge, not Photoshop semantic layer merging. |
| Divergent branch conflict | Branch B `990b2d12` versus `master` `c3fc3d4d` produced a blocked PSD/semantic comparison. An attempted helper merge was refused, leaving no changed files, `master` active, and zero changes. |
| Wrong-document save guard | Attempting to save document 106 into the current project was blocked. History remained at six versions. |
| Helper offline and recovery | Stopping the helper produced the offline banner. Restarting it and using Reconnect restored operation through the filesystem bridge. |
| Large native document | Document 147 with 521 layers was explicitly adopted. The actual helper received all 521 captured layers, found 548 differences against the grouped baseline, and the panel correctly showed 500 of 548 rows. **Saving this large document was not run.** |
| Native cancellation/recovery limit | A cancellation stress script was attempted through the debugger, but its socket stopped responding before the outcome could be observed. **Native cancellation is unverified, not passed.** Reloading UXP Developer Tools and restarting only the owned development process did not restore the debugger connection. Photoshop remained alive with low CPU usage; this does not prove its UI was responsive. |

These observations partially cover L01–L15 in [the native checklist](LIVE_ACCEPTANCE.md). They do not mark an entire multi-step row passed when only part of it was exercised. Reparenting, shape/mask/effect/smart-object cases and additional group effects, large-document save/cancellation, full rapid-edit combinations, provider/account paths, and a native Photoshop failure after Git mutation still need their own evidence where not recorded above.

At handoff, only the task-owned temporary helper sessions and UXP Developer Tools process were shut down. Photoshop was not restarted, and no artwork was closed or discarded. The test documents remain open, including the unsaved 521-layer document. The original persisted folder grant is unchanged, and the disposable acceptance project's Git working tree is clean. Restarting Photoshop requires saving any personal work and user permission; see [the next native steps](LIVE_ACCEPTANCE.md#resume-the-blocked-native-session).

## Native visual inspection

Six images were captured from the **real UXP panel** and inspected at **420 × 800 logical pixels**, with **2× raster output**:

- [Changes](../artifacts/acceptance-20260904/native-changes.png)
- [History](../artifacts/acceptance-20260904/native-history.png)
- [Branches](../artifacts/acceptance-20260904/native-branches.png)
- [Reviews](../artifacts/acceptance-20260904/native-reviews.png)
- [Wrong-document guard](../artifacts/acceptance-20260904/native-document-guard.png)
- [Large list: 500 of 548 changes](../artifacts/acceptance-20260904/native-large-list.png)

Two stale, mislabeled captures (`native-activity.png` and `native-group-changes.png`) were excluded from evidence and moved recoverably to `/private/tmp/photogit-rejected-captures-mnOxjw/`. They do not prove Activity or group visual acceptance. The temporary backup may be cleaned by the operating system.

The 2× raster scale is capture backing resolution, not evidence of the requested 100%, 125%, and 150% UI-scale checks. **The full 60 viewport/scale combinations per tab/state were not completed.** Native accessibility returned an empty window list, and no documented UXP resize mechanism was available for automating the requested panel dimensions. Foreground Photoshop assistance was requested; these limitations remain open until the missing native observations are made. No browser or DOM simulation is counted as native visual evidence.

The native screenshots predate the final placement of the Save version controls before the changes list. The large-list inspection exposed that saving previously required scrolling past up to 500 rows. The revised order has an automated DOM regression, but was **not reverified in Photoshop** after the debugger connection failed. These captures therefore show observed native workflow states, not proof of the final control order.

## Failure-to-test map

| Failure or boundary | Automated evidence |
| --- | --- |
| Ordinary Git accepted as a project; corrupt/partial metadata; ineffective ignore/LFS rules | `cli/src/doctor.test.ts` exercises actual CLI exits and diagnostics. |
| HTTP-only coverage; duplicate requests; ready-marker races; expired/late files; malformed/oversized input | `apps/desktop-helper/src/bridge.test.ts` and `main.bridge.integration.test.ts` use real filesystem bridge files; the latter starts the actual helper process. |
| Wrong-document capture; first-version response size; immutable baseline; clean-state reset; save failure preserving staged work; post-commit verification failure and unknown outcome | Actual helper-process bridge integration with synthetic captures. A synthetic PSD header is storage-test input, not live Photoshop evidence. |
| Missing/invalid/LFS snapshots; history recovery; remote-only branches; unsafe merges | `packages/git-engine/src/history-recovery.test.ts` uses disposable Git repositories and verified/tampered local LFS objects. |
| Rendered-change labels, fractional opacity, and property changes | `packages/differ/src/differ.test.ts`, schema/serializer checks, and production panel rendering tests. |
| Stale scans, cancellation, modal imaging, clicked-document save races, adoption confirmation, partial/unknown operation outcomes, escaped text, history order, keyboard controls, fresh merge confirmation/base guard | `apps/photoshop-plugin/ui-contract.test.ts` executes production panel code with explicit host/DOM mocks. |
| Unsupported group imaging; opaque-layer fallback; composite failures; old-baseline and missing-current-capture warnings | Production panel tests verify no direct group read, an extra document-composite read, narrowly scoped fallback, no comparison after composite failure, and visible migration limits. Schema/serializer/helper tests cover the optional composite field, including omitted/null current fingerprints. |
| Native capture fidelity, actual event delivery, PSD opening, docking, and responsiveness | Headless tests cannot prove these. Only the native observations above count. |

## Security and recoverable cleanup

The earlier online dependency audit and final source secret inventory passed. The final requested online audit repeat was denied and was not bypassed; its external metadata disclosure needs authorization. Security tests cover authentication, path containment, symlinks, command arguments, malformed input, byte limits, cleanup races, recovery, and token/credential redaction.

Read-only GitHub inspection found private vulnerability reporting and Dependabot security updates disabled, with secret scanning and push protection enabled. SECURITY.md now gives the maintainer's verified public email as a private reporting route. No security message was sent and no repository settings changed.

Thirteen byte-identical, unreferenced legacy PNG aliases were moved to `/private/tmp/photogit-duplicate-icons-UGCj7t/`. Originals, current icons, and media were preserved. [Exact inventory and recovery instructions](ASSET_CLEANUP.md) document the retained copies; Git history was not rewritten.

## Detection and timing limits

Layer and document appearance fingerprints use sampled images with a 64-pixel target size. A changed fingerprint reports changed rendered appearance; an unchanged fingerprint does not prove every source pixel is identical. Tiny edits or changes lost through sampling can require manual visual review. The saved PSD remains the exact visual artifact.

The layer imaging queue checks its 30-second budget between batches of up to four reads. It is **not a hard 30-second deadline** for Photoshop imaging or modal execution: an in-flight host API call must settle, and the final document-composite read has no separate forced host timeout. Cancellation invalidates results and is observed at safe checks; it cannot forcibly interrupt every host operation.

Older versions without a document-composite fingerprint are not marked dirty merely because the new capture contains one. The helper supplies a visible comparison-limit warning instead. A new saved version establishes the composite baseline; the native group test verified that the warning disappeared and the clean count returned to zero afterward. If the current capture instead omits the composite fingerprint or supplies null, the helper warns that document rendering was not compared and asks for the panel to be updated/reloaded. Zero changes alone is not proof that missing rendering coverage was checked.

## Remaining gates

- Fresh native project-folder selection/permission and clean-machine end-to-end setup.
- The complete requested native panel size/scale/state matrix, including Activity and all transient surfaces.
- Unrecorded advanced document/layer cases, large-native-document save/cancellation after debugger recovery, and remaining native failure/recovery combinations.
- Photoshop versions other than 27.10.0, Windows, other color modes/bit depths, and platform installation coverage.
- Permanent Adobe plugin ID, real CCX packaging/installation, and a distributable helper lifecycle.

The development ZIP is not a signed or installable CCX release. Media outside `artifacts/acceptance-20260904/` are historical or simulated and are not current acceptance evidence. No source commit, push, publication, repository-setting change, or merge into main was performed.

Use [LIVE_ACCEPTANCE.md](LIVE_ACCEPTANCE.md) for the missing native checks and [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) for external actions requiring authorization.
