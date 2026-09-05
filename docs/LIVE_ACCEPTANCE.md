# Real Photoshop acceptance: 0.2.0

Use disposable, synthetic artwork and an isolated project/configuration. Record the tested Git revision, Photoshop build, UXP Developer Tools version, OS, display scale, and local timestamp. Preserve each outcome in [ACCEPTANCE_REPORT.md](ACCEPTANCE_REPORT.md). A simulated demo or mocked DOM result must never be entered as a Photoshop pass.

## Workflow

| ID | Action | Required observation |
| --- | --- | --- |
| L01 | Follow QUICK_START from a fresh checkout/project. Start the helper and load the actual manifest. | Project pairs, helper health is clear, and missing requirements have actionable messages. |
| L02 | Create an RGB 8-bit PSD, connect it, scan, and save the first named version. | PSD/preview exist, history contains the version, and changes return to zero after a scan. |
| L03 | Add and then delete a layer. | Notifications trigger scans and truthful added/deleted rows appear without manual refresh. |
| L04 | Rename, reorder, reparent, hide, change opacity, and move a layer separately. | Each action appears with the right domain/value; no prior event is lost. |
| L05 | Edit text and paint pixels. Exercise a shape, mask, smart object, and effect. | Text edits are specific; rendered changes use accurate generic appearance language where causality is unknown. Unsupported capture produces a warning. |
| L06 | Make rapid edits, switch active documents during a scan, change projects, and cancel a large scan. | Only the current document/project generation updates the UI. Progress/cancel remain usable. A foreign PSD cannot silently save to the project. |
| L07 | Save a second named version. | Version appears once and change count returns to zero. Empty messages and unchanged data receive useful feedback. |
| L08 | Inspect details of the first version, then open its PSD. | Metadata/file differences appear; a separate PSD opens and current work is not overwritten. Deliberate recovery to a new version is possible. |
| L09 | Create two branches with visibly different PSD content; switch between them. | Correct branch name and matching PSD appear. Missing/invalid snapshots fail before mutation where possible. |
| L10 | Compare an incoming branch with an explicit base, including a remote-only branch. | Base/incoming labels, semantic changes, file changes, and relevant warnings agree with Git. |
| L11 | Exercise a clean ordinary Git merge and a competing-PSD conflict. | Merge shows result and base/incoming branches. Unsafe PSD merges are blocked and actual conflicts/recovery instructions are visible. |
| L12 | Stop/restart the helper; test timeout, late response, and duplicate startup. | Offline/reconnect behavior is clear. No duplicate save or misleading success. Expired bridge files are cleaned safely. |
| L13 | Cause Photoshop opening to fail after Git changes. | Panel explicitly says Git changed, refreshes branch/history, and provides recovery rather than a generic error. |
| L14 | Use long names, empty history, large layer lists, invalid input, keyboard navigation, and all menus/dialogs. | Labels, focus, selection, truncation, scrolling, and disabled controls remain clear and meaningful. |
| L15 | Test local, GitHub, and non-GitHub remotes. | Provider actions are truthful; opening a comparison never claims a pull request was created. No raw credential URL reaches the panel. |

Keep the original PSD open during recovery tests. Do not force-push, delete user work, change global Git credentials, or post a pull request to exercise local acceptance.

## Resume the blocked native session

The September 4 session lost its debugger connection during an attempted cancellation stress test. Cancellation was not observed and the 521-layer document was not saved. The owned temporary helper/UXP Developer Tools processes were stopped, but Photoshop was not restarted and no artwork was closed or discarded. Test documents, including the unsaved large document, remain open. The existing folder grant was preserved.

1. Save any personal Photoshop work first. Obtain user permission before restarting Photoshop and UXP Developer Tools; that restart has not been authorized or performed.
2. After an authorized restart, load `apps/photoshop-plugin/manifest.json` in UXP Developer Tools. Start the helper for the disposable acceptance project (`photogit-demo/.photogit/bridge/acceptance-20260904`), using its isolated configuration and `--bridge-only` if HTTP is not needed. Do not replace the user's original project or grants.
3. Reconnect the actual panel and verify the intended disposable document/project binding. Confirm the final Save version controls appear before the changes list and remain reachable with 500 rows; this late layout correction has not been reverified natively. Rerun large-document scan, cancellation, and save with visible progress and a confirmed final result. Confirm a saved version appears once and returns to zero changes.
4. Exercise fresh native folder selection/permission using another disposable project; the reused grant is not proof of this flow.
5. Complete and record the requested 60 native viewport/scale combinations per tab/state below, plus the remaining workflow scenarios. Preserve failures and blocked cases as such.

Repeating the npm service audit separately requires authorization to send dependency metadata externally. The final repeat was denied by approval review; do not bypass that decision. The earlier successful online audit and unchanged dependency lock are recorded in the evidence ledger.

## Actual-panel visual matrix

Inspect **every combination** below in the real UXP panel:

| Dimension | Required values |
| --- | --- |
| Width, CSS px | 230, 270, 320, 400, 600 |
| Height, CSS px | 200, 420, 650, 800 |
| Display scale | 100%, 125%, 150% |
| Tabs | Changes, History, Branches, Reviews, Activity |
| States | Empty, populated, helper-offline, scanning, large-list, conflict, error |

This is 60 size/scale combinations per tab/state. Record all combinations actually inspected; do not mark the matrix passed from a single wide screenshot. If the host cannot physically provide a requested display scale, record that limitation explicitly. Resizing a screenshot is not native scale testing.

Check every text field, dropdown, button, icon, badge, menu, modal, list, tooltip, scrollbar, empty state, and focus state. Look for clipping, overlaps, unreadable truncation, duplicate scrollbars, missing focus, low contrast, and controls moving out of reach at 200 px height. Exercise reduced motion and long document/project/branch/layer/author/version names.

## Evidence

Save new native captures only after the workflow they depict passes. Record each capture's revision, Photoshop build, panel dimensions, display scale, and scenario. The six images in `artifacts/acceptance-20260904/` record real 27.10.0 panel states at 420 × 800 logical pixels with 2× raster output; they do not complete the matrix. The large-list image proves the observed list state, not a successful large save or cancellation. Two stale Activity/group-labeled captures were excluded, as documented in the evidence ledger. Other existing images/video are historical. The browser prototype can help diagnose layout but is not a substitute for native inspection.
