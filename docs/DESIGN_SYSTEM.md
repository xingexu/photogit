# PhotoGit: Graphite Studio design system

Reference-led redesign · September 7, 2026 · HTML/CSS/JavaScript in Photoshop UXP.

## Reference → component map

| Reference | Implementation |
| --- | --- |
| Graphite Studio | Shared header; project, branch and document context consolidated into the wide navigation rail; purposeful content/inspector columns. |
| Compact Inspector | Narrow, labeled two-row navigation; dense changed-layer list; complete-document save composer below it. |
| Liquid Glass | Restrained overlay rims, tonal depth and soft shadows. Opaque content and fallback surfaces; no simulated refraction or glass around every row. |
| Silver Workspace | White/silver light theme, restrained blue selection, chronological History beside version details. |
| Midnight Timeline | Selected-version hierarchy, artwork-led inspector column and separate-copy inspection. Artwork is the preview PNG committed with that version, read back through the `versionPreview` operation. Versions saved before previews existed fall back to the metadata banner. No filmstrip: history is a list, not a reel. |
| Branch Atelier | Current branch first, then a card grid led by each branch tip's saved preview; branches without one keep the compact row. Separate create action. No fabricated previews or relationship graph. |
| Review Desk | Source → destination, paired branch-tip previews (shown only when both sides have one), incoming changes, and a separate merge-safety inspector. No fictional accounts, comments or reviewer assignments. |

These concepts define composition, not new capabilities. Existing project pairing, scan cancellation, operation locking, version saving, branch recovery, merge confirmation and command validation remain authoritative. Do not add fake macOS window controls.

## Tokens and typography

`apps/photoshop-plugin/styles.css` owns the base theme and one light-theme override. Reuse semantic tokens instead of introducing local color palettes.

| Token | Graphite | Silver |
| --- | --- | --- |
| `--bg` / canvas | `#191a1b` | `#f3f4f6` |
| `--surface` / content | `#202224` | `#ffffff` |
| `--elevated` | `#2b2d30` | `#eaedf1` |
| `--input` | `#191b1d` | `#f6f7f9` |
| `--overlay` | `#27292c` | `#ffffff` |
| `--text` | `#f2f3f4` | `#1c2330` |
| `--muted` | `#b4b7bd` | `#505966` |
| `--disabled` | `#8c9199` | `#6f7781` |
| `--line` / decorative separator | `#383b3f` | `#dde1e7` |
| `--border` / interactive boundary | `#828891` | `#78818d` |
| `--hover` | `#30343a` | `#e8ecf2` |
| `--pressed` | `#383e47` | `#dce3ed` |
| `--selected` | `#293849` | `#e0eafb` |
| `--focus` | `#9ac6ff` | `#245bb6` |
| `--accent` | `#afd0ff` | `#245bb6` |
| `--primary` / `--primary-text` | `#cdd7e4` / `#192330` | `#2d60b5` / `#ffffff` |
| `--primary-hover` / `--primary-pressed` | `#e5eaf0` / `#bac9dc` | `#234e98` / `#1c4080` |
| `--success` / `--success-surface` | `#a6d6ad` / `#26382d` | `#2b653b` / `#e8f2eb` |
| `--warning` / `--warning-surface` | `#efce8a` / `#3d3220` | `#765006` / `#fbf1db` |
| `--error` / `--error-surface` | `#ffb2ac` / `#432a29` | `#a12e29` / `#fceceb` |
| `--rim` | `#494d52` | `#c5cbd3` |
| `--shine` | `rgba(255,255,255,.055)` | `rgba(255,255,255,.65)` |
| `--shadow` | `rgba(0,0,0,.28)` | `rgba(27,35,48,.11)` |
| `--backdrop` | `rgba(0,0,0,.5)` | `rgba(21,29,42,.24)` |

- UI family: `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`. Inputs, placeholders and Spectrum controls request the same family and upright style. Photoshop may retain host-owned italic placeholders; native inspection confirmed this fallback without replacing the actual input with decorative text.
- `--text-body: 13px`, `--text-small: 12px`, `--text-title: 18px`. Body line-height is 1.5; heading weight 600. Compact section headings use 15–16px; count facts 17px. Only identifiers, syntax, keycaps and minor badges use 11px. Minimum-width navigation also uses 11px to retain every label.
- `--mono: "SFMono-Regular", Consolas, monospace` for command syntax, commit IDs and technical paths.
- Spacing tokens: `--space: 4px`, `--space-2: 8px`, `--space-3: 12px`, `--space-4: 16px`, `--space-6: 24px`.
- Radii: `--radius: 8px` controls, `--radius-panel: 12px` grouped tasks, `--radius-overlay: 16px` menus/sheets. Badges and compact chips use 4–6px.

Accent indicates selection/action; green, amber and red communicate actual status. Preserve neutral artwork colors. Decorative separators are intentionally quieter than input boundaries. Contrast tests are source-token checks, not a certification of native widget rendering.

## Material and geometry

Radii run 9 / 13 / 20 / 26 for chips, controls, cards and overlays. Control heights are 32 and 40. A single spacing scale of 4 / 8 / 12 / 16 / 20 / 24 supplies every gap; `verify:tokens` fails the build when a declared token is not referenced, so the block stays a description rather than a wish list.

Cards carry the glass material: a bright inset top edge, a hairline ring, an inner bloom and a deep soft drop over a translucent fill. The depth comes from the rim, gradient and shadow, so the hierarchy survives where the host cannot blur; the blur is applied only behind an `@supports` guard. Under `prefers-reduced-transparency` the glass token points at the opaque surface, the sheen is removed and the blur is turned off.

Surfaces run canvas, content, glass, then nested. A card placed inside a glass card takes the nested tier, which sits just above the colour the glass composites to — the plain surface tone is darker than that on the dark theme and reads as sunken.

Interaction eases on `cubic-bezier(.22,.9,.24,1)`. A press compresses in 200ms and releases over 480ms, pairing with a veil that fades in fast and out slowly; the veil always darkens, because a lightening veil dropped the primary button's label below the contrast floor. Hover lights a destination's rim and lifts its icon and count. Under `prefers-reduced-motion` the transitions and the displacement both go.

## Responsive composition

All dimensions are logical pixels, not screenshot raster pixels. The manifest supports 230×200 through 2000×2000, with preferred docked size 400×760 and floating size 420×800. The application reading shell stops growing at 1600px.

| Available width | Composition |
| --- | --- |
| 230–639px | Compact header/context; six labeled tabs in two rows; layer list before save composer. Version/review selection opens a sheet. No permanent sidebar or sticky composer covering content. |
| 640–719px | Six tabs in one row; otherwise stacked content. Sheets are centered at 580px. |
| 720–899px | Navigation becomes the vertical rail card and the context card spans above it, so a floating panel gets its rail before it is wide enough to split content. |
| 900–1199px | 148px navigation card; project, branch and document sit in their own card spanning above it. Changes: flexible list + 280px composer. History: 250px list + details. Reviews: 290px list + comparison, with status stacked inside the inspector. Branch creation is a separate 260px column. |
| 1200px+ | 164px navigation card; 330px composer; 300px History list; 330px review list. Comparison summary and 220px safety inspector can sit side by side. |

Below 360px, decorative navigation glyphs and the extra change-domain column recede. Below 280px, tab counts and footer glyphs recede; destination labels remain. Long names/paths wrap, flex children use `min-width: 0`, and the document remains the main scroll region. At minimum height, controls stay reachable by scrolling rather than being overlaid.

## Screen and interaction rules

- **Changes:** compact scan summary; searchable All/Visual/Text/Structure display filters; aligned name, layer identity, summary and semantic status. No selective-commit checkboxes. Save captures the whole PSD, including filtered-out edits. The 500-character composer has a live count, append-only suggestions and a jump-to-message action; suggestions never truncate an existing draft. No-match and no-edits states are distinct.
- **History:** chronological, searchable version list with localized times. Selection reveals real commit, author, date, snapshot availability, warnings and recorded edits/files. Narrow sheets and wide inspectors share `version-inspector.js`; opening remains an explicit separate-copy action. Without preview data, a compact metadata banner replaces the artwork column and facts wrap into two columns when space allows. When a preview is supplied, the artwork column leads at a 1.35:1 ratio against the metadata column; `version-inspector.js` accepts only relative `assets/*` image paths flagged `demo: true`, and always captions them as illustrative rather than as a saved PSD preview. Inspector edit/file lists show 40 records initially, with more available on demand.
- **Branches:** `branch-view.js` presents actual local branch names and current state, current first. Row selection itself does not switch. Explicit Switch delegates to the existing command/confirmation path; the current branch has no Switch button.
- **Reviews:** `review-inspector.js` separates source → destination, common-ancestor-to-source changes, and safety status. Edits/files/conflicts are limited to 100/500/500 displayed entries with accurate total notices; every warning remains visible. Only an eligible comparison offers **Review merge…**, which delegates to revalidation and confirmation. Known conflicts or contradictory readiness are inert. Ordinary Git merge does not blend PSD layers or resolve Photoshop conflicts.
- **Activity:** compact chronological feed with aligned time, status mark, existing repetitive-scan grouping and expandable technical detail.
- **Docs/Commands:** aligned glyph, title, monospace syntax and short description. Search and palette navigation use the fixed command dispatcher, never a shell. Terminal instructions remain separate.
- **Setup/notices/dialogs:** same type and surface hierarchy; useful next actions, bounded scrollable sheets, visible errors, Escape dismissal and focus return. Native fields beneath a modal are hidden to prevent painting through it.

Regular controls are at least 34px high; small controls 30px; fields 36px; the Save action 38px; navigation and menu rows at least 36px. Controls change tone on hover/press without moving their hit areas. Primary actions carry the strongest contrast; not every container gets a bright outline.

Custom controls retain roles, names, Enter/Space activation and explicit disabled checks. Navigation uses labeled tabs and selected state. Buttons respect busy/initializing state and hidden ancestors. Use 2px focus rings; `:focus-visible` suppresses pointer-only rings where supported, with ordinary focus as the fallback. Reduced motion is honored. **Commands** is the reliable palette entry: `/` outside fields and Cmd/Ctrl+K only work when Photoshop delivers those events; no host-wide shortcut is registered.

## UXP boundaries

The [Adobe UXP styles reference](https://developer.adobe.com/photoshop/uxp/2022/uxp-api/reference-css/styles/) is the baseline for supported flex layout, colors, borders, radii and typography. Shadows, CSS transitions and selector/media enhancements are optional decoration; losing them must not remove hierarchy or functionality. Nothing depends on backdrop blur: it is applied only behind an `@supports` guard, and the rim, gradient and shadow carry the material without it. Spectrum styling is explicitly themed, but host-owned internals require native inspection.

The timing vocabulary lives in the tokens described above. `motion.js` applies only shallow local opacity: view entry 94%→100% over 288ms, clicked control 96%→100% over 200ms, and the foreground surface after a theme change 97%→100% over 280ms. Theme preference changes immediately. Header/navigation do not fade, no layout dimensions animate, no descendant colors are repainted frame by frame, and no action waits for animation. Overlapping effects cancel cleanly and restore original opacity. If native compositing differs, retain the opaque tonal feedback instead of claiming browser animation proves native behavior.

## Saved previews

PhotoGit commits a preview PNG to `.photogit/previews/document.png` when it saves a version. The `versionPreview` helper operation reads that blob back for any version or branch tip, so every artwork surface shows a real saved preview rather than decoration.

- **Boundaries.** Git-engine caps a preview at 12 MB, requires the committed size to match the bytes read, and verifies the PNG magic number; anything else returns `null`. Reading never moves `HEAD` or touches the working tree. Previews are ordinary blobs — only `*.psd`/`*.psb` are LFS-tracked — so an LFS pointer means the bytes are not in the object database and the preview is treated as absent.
- **Transport.** The helper returns base64 with an explicit `image/png` content type. The panel validates `available`, `contentType`, `bytes` and a strict base64 charset before building the image URL itself; helper text is never interpolated into markup.
- **Rendering.** Every preview surface accepts only `data:image/png` or `data:image/jpeg` base64 — never remote URLs, SVG, or filesystem paths. UXP only loads an image once it is attached to the document, so previews are appended before their source is set. Any load failure degrades to the metadata state.
- **Absence is normal.** Versions saved before previews existed, and branches whose tip has none, show the metadata banner or compact row. Reviews show paired previews only when both branches have one, so a comparison never reads as a diff against nothing.
- **Cost.** Branch previews load in the background after the branch list is usable, are bounded to 12 per project, and are cached until the project changes. A slow or missing preview never delays branch switching.

## Honest data and validation

The current `versionDetails` response contains version metadata, files, semantic changes, snapshot availability and warnings—not renderable previews, dimensions, color mode or total layer count. The compact PSD-summary fallback explains this; it must not invent a canvas or sample document facts. Branches expose names/current flags, not previews or graph relationships. Reviews expose change data, not side-by-side artwork. A clearly labeled demo may illustrate supported data shapes; it must not imply Photoshop/Git operations occurred. The version renderer's optional local demo-image path is explicitly demo-only and is not a production preview API.

Validation for this revision is pending the implementation report. Historical screenshots or test counts are not acceptance evidence for this redesign. Run:

```sh
npm test
npm run check
npm run verify:security
npm run package:development
npm run verify:package
git diff --check
```

For the simulated preview, serve `apps/photoshop-plugin` on loopback port 8766, then run `node scripts/verify-design.mjs`, `node scripts/verify-workspace-interactions.mjs`, and `node scripts/verify-reference-layout.mjs`. Set `PHOTOGIT_BROWSER_CLI` if needed and `PHOTOGIT_DESIGN_ARTIFACTS` / `PHOTOGIT_REFERENCE_ARTIFACTS` to private screenshot directories. Browser simulation verifies layout and presentation interactions, not real save/merge correctness.

- [ ] Inspect narrow dark Changes and wide dark Changes at the declared minimum and representative 400/420px, 900px and 1200px+ widths.
- [ ] Inspect dark/light History selection, Branches, Reviews, Activity and Docs.
- [ ] Inspect command palette, one dialog, empty, disabled, error and loading states.
- [ ] Verify wrapping, scroll access, focus return, command navigation, theme persistence, filtering and immediate action dispatch.
- [ ] Verify the actual Photoshop panel independently, including narrow/wide layout, Spectrum controls and keyboard delivery. Do not change or close user artwork for visual testing.

The final implementation report should state which checks actually ran, link actual screenshots with demo/native labels, and list outstanding native verification. Keep private artwork/screenshots local. No push, publish or deploy step is part of this redesign.

## Depth and interaction

Depth is decoration layered over a panel that is complete without it. Three
rules hold everywhere:

- **Nothing waits on it.** No animation gates a click, delays a handler, moves
  focus, or changes layout. Every effect is a transform, an opacity, or a
  custom property the stylesheet reads.
- **Nothing depends on it.** `depth.js`, `counter.js` and `reveal.js` are each
  optional at the call site. When a module is absent — as it is in the contract
  tests, which execute the panel script alone — the panel renders the same
  values by a shorter path.
- **Reduced motion removes it, rather than shortening it.** Depth drops its
  transform outright, the counter jumps to its total with no timers scheduled,
  and reveal clears its own marks.

`depth.js` writes `--tilt-x`, `--tilt-y`, `--pointer-x` and `--pointer-y` from
one delegated pointer listener; every one defaults to the flat, centred value,
so a host that never fires the events renders exactly the card it renders
today. The 3D rules are additionally wrapped in an `@supports` check, because
UXP hosts do not all composite `perspective()`.

The tilt is capped at 2.4 degrees. A card that leans further reads as a toy
beside Photoshop's own chrome, and a steep lean shears the text it carries.

## Entrances and state changes

Beyond depth, the panel moves in exactly two situations: something arrives,
or a value changes. Both use the same four motions and nothing else.

| Motion | Keyframes | Used for |
| --- | --- | --- |
| reveal | rise 6px, fade in | rows, cards, tally tiles, document facts, inspector sections, activity rows, empty states, unfolded details; staggered through `reveal.js` where there are several |
| fade-in | fade only | status line, scan verdict, saved preview, filter count, Cancel scan, the workspace and first-run card after startup |
| sheet-in | rise 10px, fade in | tool sheets, the tools menu, notices |
| pop / rule-in | scale in and settle | a count pill going from zero; the active section's rule |

Rules that hold for all of them:

- **Backwards fill only.** An entrance's end frame is the element's resting
  state, so the animation is released the moment it finishes. A forwards
  fill would keep the element on its own compositing layer, and its text
  would rasterise a shade differently from the text beside it. Only the
  closing fade, whose end frame is *not* the resting state, keeps a fill.
- **Replay is explicit.** A value that replaces another (the status line, the
  scan verdict) is replayed by `restartAnimation()`, a one-element reflow that
  runs only when a value lands. Nothing polls.
- **The list is complete first.** Every stagger is applied after the DOM it
  decorates is rendered and interactive; the contract tests assert the
  callback sees finished rows.
- **Continuous motion is bounded.** The only looping animations — the busy
  track, the breathing watch-status dot, the startup skeleton — run while a
  state is genuinely in progress and stop with it.
- **Reduced motion cuts.** Every animation is removed by the reduced-motion
  block; nothing starts from `opacity: 0` in its own rule, so a host that
  strips animations still shows every element at full opacity.

