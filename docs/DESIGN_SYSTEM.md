# PhotoGit Studio design system

September 7, 2026 · development UI · native UXP, no framework migration.

## Direction

A neutral silver/graphite workspace with clear task hierarchy, rounded surfaces and restrained depth. This replaces the accumulated editorial/glass/blue-accent overrides with one stylesheet and exactly two theme-token blocks. Green, amber and red are reserved for semantic status. Text remains opaque and readable; there is no backdrop blur or refraction.

| Token | Dark | Light |
| --- | --- | --- |
| Canvas | `#181818` | `#F2F2F2` |
| Surface | `#242424` | `#FFFFFF` |
| Supporting text | `#BDBDBD` | `#555555` |
| Primary control | `#E6E6E6` | `#333333` |
| Hover | `#393939` | `#E4E4E4` |
| Pressed | `#494949` | `#D0D0D0` |

System sans-serif: 13px body, 12px controls/supporting copy, 18px page titles. Identifiers and command syntax use system monospace. Spacing follows 4/8/12/16/24px. Controls have 10px radii; task surfaces 16px. Primary controls are at least 36px high. Quiet metadata is smaller; it never replaces an accessible control name.

Text/supporting-text tokens meet 4.5:1 on the main surfaces; border/focus tokens meet 3:1 there. Primary text is contrast-tested in all three button states. Decorative separators/rims are intentionally quieter. These source-token tests are not a complete accessibility certification or a measurement of native widget internals.

## Page hierarchy

- **Shared shell:** compact brand, Commands, sun/moon and tools; repository context with a branch-management shortcut; six evenly sized destinations; a quiet sync footer.
- **Changes:** scan status, save composer, searchable/filterable edit list, optional branch review. A filter is explicitly display-only: the saved PSD still includes the whole document. No-match and no-edits states are distinct.
- **History:** searchable versions grouped into a timeline. Each row opens inspection. Prior PSDs still open as separate copies.
- **Branches:** separate working-branch and new-direction tasks, with the original document/branch safety explanation retained.
- **Reviews:** individual comparison cards, meaningful availability labels and explicit Compare/Merge actions. Conflicts remain explanatory notes, not fake clickable controls.
- **Activity:** readable session log; existing bounded/expandable scan grouping remains intact.
- **Docs:** searchable command cards and separate Terminal setup instructions. Commands still use the fixed dispatcher, not a shell.
- **Setup/loading/dialogs:** shared type, radii and spacing; one loading surface; bounded opaque dialogs with Escape/focus return. No delayed visibility gates were introduced.

At narrow widths the six tabs form two equal rows, rather than leaving orphan tabs. At 640px they fit one row. Icons/counts recede at minimum width without removing labels. Reading width is bounded to 760px. The document remains the primary scroll region; no sticky element covers controls in a short Photoshop panel.

## Interactions and host constraints

`workspace-ui.js` is shared by production and the simulated preview. It implements case-insensitive change search, All/Visual/Text/Structure display filters, one-click filter reset, branch navigation and panel-local command shortcuts. Rendered changes retain their full count and original selection handlers. Repeated setup is idempotent; startup, busy state and open surfaces block shortcuts. Filter state survives a refresh and resets when no edits remain.

Use **Commands** as the reliable palette entry. `/` outside a field and Cmd/Ctrl+K are handled only if Photoshop delivers those events. Photoshop may intercept modifier keys. No Photoshop-wide shortcut is registered. Enter in the message field still invokes the existing guarded save path.

CSS hover/press states use distinct gray shades without moving hit targets. Existing timer-driven motion stays bounded: 82%→100% entrance over 380ms, theme 100%→82%→100% over 180ms + 380ms, click 90%→100% over 240ms. Native color blending covers the new surfaces and restores inline styles; work is capped at 180 visible nodes. Reduced motion bypasses fades; reduced transparency removes decorative gradients where supported.

Layout uses the [Adobe UXP CSS reference](https://developer.adobe.com/photoshop/uxp/2022/uxp-api/reference-css/) as the host baseline. Shadows, CSS transitions and pointer-only focus suppression are progressive enhancements. Spectrum picker/progress internals may follow Photoshop's own theme. Browser appearance does not establish native appearance.

## Verification for this revision

- 293 tests across 17 files passed, including production panel contracts, motion, 12 shared-workspace tests and a production-rendered filtering regression.
- Type checks, source security inventory and the 14-file development-package verification passed.
- `scripts/verify-design.mjs`: six destinations in both themes at 230×200, 320×600, 420×800 and 900×800; empty, 500-long-row, error, setup and loading states; persistence, palette navigation and focus return.
- `scripts/verify-workspace-interactions.mjs`: both themes; type/text filters, no-match/reset, source-count preservation, branch shortcut, keyboard palette navigation, simulated save with an active filter, version inspection and appearance toggle. No Photoshop or Git operation occurs in this script.
- Initial native checking was blocked by the unavailable debugger. After Adobe sign-in and relaunching Developer Tools, the loader reported **Loaded** and a local native screenshot confirmed the redesigned dark panel, restored project and **Helper online** status. Runtime debugger evaluation still timed out; native Light mode, all-page layout, Spectrum internals and physical-keyboard acceptance remain unverified. No user artwork was changed, and the native screenshot is not included in the repository.

Run a loopback static preview with `python3 -m http.server 8766 --bind 127.0.0.1 --directory apps/photoshop-plugin`, then run either verification script. Set `PHOTOGIT_BROWSER_CLI` if agent-browser is not on PATH and `PHOTOGIT_DESIGN_ARTIFACTS` to choose a private output directory. Older native screenshots/results remain historical evidence, not proof of this redesign.
