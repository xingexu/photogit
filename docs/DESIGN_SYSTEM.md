# PhotoGit design system

September 5, 2026 · development revision · native UXP, no framework migration.

## Direction

Compact, typography-led workspace: small identity, project and connection, document context, natural-width section tabs, active task, quiet sync footer. The restrained navigation and composition of [Martin Sit’s site](https://martinsit.ca/) informed the direction, without copying assets or layout. Save version stays above long change lists. Earlier versions still open separate PSDs; merge remains ordinary Git, not visual blending.

## Tokens

The single production stylesheet `apps/photoshop-plugin/styles.css` defines both themes. Theme colors belong only in the root token blocks; component rules reference semantic names.

| Role/token | Dark | Light |
| --- | --- | --- |
| Canvas `--bg` | #17191D | #E9EDF3 |
| Surface `--surface` | #24272D | #FFFFFF |
| Elevated `--elevated` | #30353D | #F5F7FB |
| Text `--text` | #FFFFFF | #151D29 |
| Supporting text `--muted` | #C5CCD6 | #404E61 |
| Separator `--line` | #474D58 | #C2CAD5 |
| Control boundary `--border` | #9BA7B7 | #69768A |
| Focus `--focus` | #AFC5FF | #365BBB |
| Selection `--selected` | #333C50 | #E5EBF8 |
| Success `--success` | #91C6A0 | #24683C |
| Warning `--warning` | #E3C17C | #805900 |
| Error `--error` | #EEA19A | #A32E28 |

Additional tokens define input background, hover/pressed states, inverse primary controls, status surfaces and backdrop. Disabled controls retain their label and use reduced opacity plus `aria-disabled`; disabled controls are not a color-only status signal. Spacing tokens are 4/8/12/16/24/32px. One system sans-serif family throughout, including commands and identifiers: 12px body, controls and supporting text; 14px headings; 18px onboarding title. Semibold is consistently 600. The header title uses 12px at the minimum width. Controls are 32–34px, compact controls at least 28px, radius 8px (12px cards/sheets), motion 120ms with reduced-motion override.

Automated token checks require text and supporting text to exceed 4.5:1, and interactive boundaries/focus to exceed 3:1, against canvas, surface, elevated, input and selected backgrounds in both themes. Primary-button text also exceeds 4.5:1. Separators are intentionally quieter and must not substitute for control boundaries. Native widget internals are an exception requiring separate host verification (below).

## Component and responsive rules

- Rounded task cards separate scanning, saving, changes and reviews. The save card has one field prompt, “What changed?”, instead of a repeated heading, data caption and field label. Duplicate edit-count status and section eyebrows are removed. Layer IDs remain concise inline metadata (and full accessible row names); document identity, warnings and action labels remain.
- One dominant action per task: Save version, Create branch, or the explicit confirmation. Never hide essential actions behind hover.
- Changes retains one visible Scan now control and command access. Version message and Save precede the list; error and cancellation controls remain intact.
- Six text-labeled tabs wrap by content width rather than occupying an oversized equal-column grid. Changes/History/Branches have stronger weight. Active secondary destinations remain visible. Arrow/Home/End navigation and tab semantics are preserved.
- At 230px, counts in navigation are suppressed, context wraps and Scan takes a full row. At 320px, tabs wrap naturally. At 420px tabs can wrap to a second row without shrinking text. At 900px, reading width remains bounded to 680px. Existing detail sheets are capped at 600px rather than stretched across the window.
- The document is the primary scrolling region; no sticky header/footer can cover task controls at 200px height. Menus and sheets have their own bounded overflow while open.
- Setup instructions start collapsed behind an explicit button with expanded state. Technical activity entries over 160 characters disclose their full text on demand; the log retains at most 50 rows, newest first.
- Docs and the palette use the same fixed command registry. Syntax uses the same readable font; purpose remains one short line where space permits. Terminal setup is separate from panel commands.
- Focus rings, accessible labels, Escape, dialog focus containment and trigger focus return remain. No Photoshop global modifier shortcut is registered.

## Appearance behavior

Startup now paints a single rounded loading surface in the saved theme. Setup and workspace stay hidden until restoration finishes, so a connected project never flashes the onboarding screen. Project-grant and pairing reads each have a 15-second deadline; startup helper reads use 5-second deadlines instead of the Git-operation timeout. Late filesystem results cannot reconnect a stale project. A `finally` path releases loading on failures and exposes setup/reconnect controls; theme switching remains available throughout. No animated shimmer, fake percentages or artificial minimum wait is used. Lifecycle initialization is idempotent, and commands/automatic scans are gated during restoration.

Dark is the new-install default. Click the header sun to switch to Light or the moon to switch to Dark. The large appearance selector and saved-preference copy have been removed. The compact repository menu retains its actions and is capped at 256px. `appearance.js` runs synchronously in the document head before the stylesheet/UI startup, validates `photogit.appearance` in localStorage, applies `data-theme`, then updates the icon button’s accessible action name after DOM readiness. Unknown values and read failures use Dark. Write failures retain the selection for the session and show a storage-unavailable message. Project-token storage read failure also no longer prevents startup.

This is an explicit panel preference, not “Match Photoshop.” Text fields use `appearance: none` so native host chrome does not paint dark backgrounds inside Light. Existing native input/keyboard handlers and Spectrum controls are preserved. Native background fields are hidden while sheets or menus are open to prevent UXP paint-through; values are not removed.

Adobe documents [CSS variable support](https://developer.adobe.com/photoshop/uxp/2021/uxp/reference-css/General/variables/) and [UXP layout/control limitations](https://developer.adobe.com/photoshop/uxp/2022/uxp/known-issues/). Native rendering is not assumed to match Chromium.

## Evidence and remaining gaps

Startup follow-up: 267 tests passed (135 panel tests), including restoration, duplicate lifecycle events, command gating, malformed/expired pairing, unavailable preferences, offline helper, late responses, cleanup and notification failure. Final type, source-security and development-package verification passed. [Current simulated matrix](../artifacts/startup-ui-20260905/demo-matrix.json) covers all previous sizes/stress states plus the loading surface in both themes. Final label cleanup keeps Status a stable action, removes the repeated current-branch card and moves “Inspect version” from every visible history row to its accessible action name.

All six destinations were also inspected in both themes in an **actual 318×800 native viewport**, with no inline width constraints or browser emulation. [Native matrix](../artifacts/startup-ui-20260905/native-matrix.json), [Light Branches](../artifacts/startup-ui-20260905/native-light-branches-318x800.png), [Dark History](../artifacts/startup-ui-20260905/native-dark-history-318x800.png). Reload restored the helper and five edits and released the loading gate. Injected native DOM Enter dispatched `/docs`, closed the palette, and searching “merge” returned two commands. This is not physical-keyboard acceptance. `node scripts/verify-native-design.mjs <confirmed-native-window-id> <artifact-directory>` reproduces read-only tab/theme captures through the existing local UDT debugger and restores the original theme/tab.

The 318px evidence closes one actual narrow-window gap only. Spectrum's picker interior and native placeholder styling still follow host conventions; other native sizes, OS/UI scales and all destructive Photoshop scenarios remain outside this pass. No artwork was saved, switched or merged.

Rounded-UI follow-up: 255 tests passed across the full suite and corrected UI-test rerun (123 panel tests). The [updated matrix](../artifacts/rounded-ui-20260905/demo-matrix.json) includes screenshots of all six destinations in both themes at 420×800, plus all previous viewport/stress checks. [Native Dark Changes](../artifacts/rounded-ui-20260905/native-dark-changes-814x800.png) confirms the new tokens, rounded surfaces, concise field prompt and layer labels in Photoshop at 814×800. No artwork was mutated. Earlier evidence below is historical.

Automated source checks: 253 tests passed, including appearance/activity cases, icon-child clicks, Enter/Space, held-key suppression, storage failure and reload persistence; TypeScript, security inventory and development package verification passed. Tests execute production panel behavior with mocked host APIs, not real Photoshop mutations.

`scripts/verify-design.mjs` drives the installed agent-browser CLI against a loopback static server on port 8766. Run `python3 -m http.server 8766 --bind 127.0.0.1 --directory apps/photoshop-plugin`, then `node scripts/verify-design.mjs` (set `PHOTOGIT_BROWSER_CLI` if the executable is not on PATH).

The explicitly simulated demo imports production HTML, CSS, appearance startup and command registry. It does not perform Photoshop/Git operations. Its native Spectrum dropdown is represented by a browser select; do not use that as native Spectrum evidence. The demo’s dispatch remains simulated.

The [matrix results](../artifacts/appearance-toggle-20260905/demo-matrix.json) cover both themes at 230×200, 320×600, 420×800 and 900×800 logical pixels, all six destinations at each size, plus empty, error, setup and 500-long-row states at 320×600. It verifies horizontal bounds after layout settles, theme reload persistence, `/docs` navigation, Escape and focus return. Representative [dark](../artifacts/appearance-toggle-20260905/demo-dark-420x800.png) and [light](../artifacts/appearance-toggle-20260905/demo-light-420x800.png) screenshots are simulated, 420×800 at 1×.

Native Photoshop 27.10.0 was available. Actual panel rendering, menu, appearance changes and branch controls were inspected in an 814×800 logical viewport, captured with native window chrome at 2×. Light persisted after a developer-tools reload; an injected native DOM Enter event dispatched `/docs` successfully. The [Light palette](../artifacts/design-system-20260905/native-light-palette-814x800.png) is native, not simulated. The [320px Dark content constraint](../artifacts/design-system-20260905/native-dark-constrained320-in814x800.png) is explicitly **not** a native viewport resize. Automated mouse resize and system-keyboard delivery did not establish narrow native window or physical text-entry acceptance; those remain unverified. No artwork was saved, switched or merged for this UI pass.

**Remaining theme gap:** the built-in Spectrum branch picker retains Photoshop’s host-theme interior despite panel CSS. It remains readable in the tested dark-host/light-panel combination, but does not fully match the selected panel theme. Native placeholder/selection colors, the picker popup, progress internals, all host themes, Windows and all requested actual native sizes still need acceptance. Do not claim complete native theme coverage. Replacing Spectrum with another library or changing Photoshop’s global theme was deliberately not performed.

The moon/sun follow-up authorizes committing and pushing the complete UI update to GitHub. Native follow-up confirmed the old selector is absent, the accessible action changes with the selected theme, and the preference is saved. See the [native Light header](../artifacts/appearance-toggle-20260905/native-light-814x800.png). Earlier native screenshots linked above are historical evidence; host-widget limitations still apply.
