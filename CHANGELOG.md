# Changelog

## Motion pass II · feedback at the control

Fifty commits, one motion each, all bounded, all released once
finished, all held still under reduced motion; see the motion table in
`docs/DESIGN_SYSTEM.md`.

- Arrivals: a selected section rises into place, a status message
  rises like a notice, sheets grow slightly as they arrive and shrink
  as they leave, a sheet's action and an empty state's explanation
  follow their content by a beat, palette results and directory rows
  step in, history group headings fade with their rows, the aurora
  fades up on open, and the branch, document and project names fade in
  when they change.
- State changes: the active section's icon pops, a filter chip pops as
  it is pressed, a number lifts while it settles, a row settles into
  its selection tone, the version just saved glows once, the helper dot
  pops when the helper comes online, a failure mark pops in the feed,
  and the message counter pops as it nears the limit or refuses a
  suggestion.
- In progress: Scan now turns its arrow during a scan, the footer
  action whose operation is running turns its icon, the helper dot
  breathes during a reconnect, a sheen crosses Save version while a
  save runs, three bars pulse while a version or comparison loads, and
  the busy track's bar glows.
- Hover: branch and review cards lift, tally numbers, suggestion chips,
  command glyphs and footer icons lift a pixel, the branch chevron and
  jump arrow move the way they point, the close glyph and the open
  tools toggles turn a quarter, header icons grow, the magnifier lights
  with its field, the theme toggle takes a halo, and a card glows while
  a field in it has focus.
- The jump link flashes the field it lands in, and every new movement
  is listed in the reduced-motion block.

## Apple-style pass · aurora, capsules and glow

Five commits that move the panel toward the platform's own glass, on
request, and were reloaded and measured in Photoshop 27.10.

- Three soft colour bubbles (blue, violet, teal at low alpha) sit fixed
  behind the panel as an aurora, so the glass has colour to be glass
  over. They are a real element behind the panel root, take no pointer
  events, and go under reduced transparency and `prefers-contrast:
  more`. Text still sits on the opaque card fills.
- Radii step up to 10 / 14 / 24 / 30, the card rims are brighter and the
  glass glow gains a wider coloured bloom.
- Buttons, fields, the command trigger, chips, pills and the round header
  actions are capsules, with a little more side room for their text.
- Light mode is glass too: cards are a translucent white over stronger
  colour bubbles, with a white inner edge and a bluish hairline, instead
  of near-opaque white on grey.
- The changed-layer list scrolls inside its card, 480px tall and 640px
  from 900px, so the search, the filters and the composer beside it stay
  in reach however many edits a scan finds.

## Polish pass · keyboard rows, announcements, and the spacing scale

Two hundred commits, one change each, verified by the panel suites and
the CI verifiers after every one and by the full suite and package
checks along the way. Nothing here changes what the helper or the
engine do.

- Keyboard: the filter chips, message suggestions and footer actions
  are toolbars the arrow keys move through; Escape clears a search that
  has text; Enter or Down moves from a search into its first result; a
  refusal for a missing message or name puts the cursor in the field;
  the panel reopens on the section it was closed on.
- Announcements: helper status, watch status, empty states and notices
  are live regions, errors are alerts, a tab's count is part of its
  name, the wordmark and rail mirror are no longer read twice, and every
  time shown is a `time` element with the recorded timestamp.
- Names and labels: controls are named by the words they show (Scan
  now, the branch picker, the tabs), both tools buttons say they open a
  menu, the command trigger declares its shortcuts, the message field
  is described by its counter, the first-run steps are a list, and each
  history group and review card is a heading.
- Visible states: filter chips count the edits behind them, the new and
  deleted tallies take their rows' colours, Clear is disabled while the
  feed is empty, the composer dims while an operation runs, disabled
  primary actions lose their glow, a success message fades out, counts
  hold steady in tabular figures, and the setup disclosure turns a
  chevron.
- Preferences: forced colours keep selection, chips, the busy track and
  disabled controls visible; `prefers-contrast: more` raises separators
  and rims; reduced motion also holds the hover displacements.
- Spacing and type: every padding, margin and gutter now reads the
  spacing scale (with `--space-5` added to the documented tokens),
  inline icons sit 8px from their labels, card headings share the
  subhead size, and the palette's field wears the search fields' shell.
- Housekeeping: motion.js, appearance.js and the demo's commands.js are
  stamped like every other asset; a dead divider rule, a dead margin
  and an inert card class are gone; the design system's token table
  matches the stylesheet.
- Native follow-up, measured in Photoshop 27.10 after loading the
  panel through the UXP developer service: the sticky header rendered
  out of flow and covered the context card, so the header scrolls with
  the panel again (the browser demo keeps its own sticky header); a
  helper-offline error now clears as soon as the helper answers, and
  Reconnect says so.

## Motion pass · entrances and state changes

Twenty-nine commits, each one place the panel snapped where a transition
carries meaning. Four motions only (reveal, fade-in, sheet-in, pop), all
released once finished, all removed under reduced motion; see "Entrances
and state changes" in `docs/DESIGN_SYSTEM.md`.

- Arrivals: empty states, notices, the status line, the tally tiles,
  document facts, branch and review cards, inspector sections, activity
  rows, tools-menu items, the saved preview, Cancel scan, the filter
  count, and the workspace or first-run card after startup.
- State changes: the selected row's accent edge eases with its fill; a
  count pill pops when it first leaves zero and settles onto its number
  through `counter.js`; the active section's rule draws out; the theme
  toggle cross-fades sun and moon; the helper status, watch status and
  message counter ease between colours; the scan verdict fades in over
  the old one; a suggestion landing in the message field flashes it.
- In-progress states: the watch-status dot breathes while layers are
  read (and the warning state now has a colour); the startup skeleton
  pulses.
- Filtering steps the surviving rows back in; unfolding activity details
  or setup instructions eases open.
- Every entrance fills backwards so the element is released once it
  lands; the previous forwards fill left revealed rows on their own
  compositing layer with visibly different text weight.

## UI pass · every panel surface audited at 230–1600px in both themes

Fifty small commits, one defect each, verified against rendered
screenshots of the simulated panel at six widths and both themes plus
the existing suites. Nothing here changes what the helper or the engine
do; everything is presentation, markup, or the script that drives it.

- Text that broke mid-word: the wordmark below 320px, section labels
  between 640 and 719px, branch and document names in the context card,
  and setup commands in the onboarding and Docs cards.
- Dead surfaces removed with their plumbing: a hidden Refresh control
  (now a tools-menu item), a hidden second Scan button, a hidden change
  total, a hidden toast that duplicated every status message, a hidden
  branch-review card on the Changes view, placeholder spans no rule
  showed, a dead disclosure on review cards, and four unstyled classes.
- Busy feedback now renders in every host: one CSS progress track under
  Save version replaces `<sp-progressbar>` and a track the stylesheet
  hid, and holds still under reduced motion.
- Surfaces that the script already waited to fade — the tools menu and
  the backdrop — now fade; smooth scrolling is off under reduced motion.
- Accessibility: inspector landmarks are regions rather than nested
  asides; tally terms precede their values; the section rail answers Up
  and Down; fields with visible labels are named by them; two controls
  no longer announce different words from the ones they show; an empty
  command search renders as a status; the message counter warns near
  the limit and says when a suggestion does not fit.
- State that went stale: the tally and filter bar now clear with the
  list when a document is not connected; a save no longer wipes the
  History search; History tells a new project apart from an empty
  search.
- Layout: the header status collapses to its dot below 360px; tabs run
  two to a row below 330px; the header menu clears the header; first-run
  cards centre on wide layouts and notices share the content margin;
  previews on branch cards and in the comparison show whole.
- Theme: hover and focus glows read from `--glow` and `--focus-halo`,
  which the light theme sets to a visible blue.
- Demo: the panel fetch no longer carries a stale build id, the tally
  recounts with the list, activity rows use the production marks, and
  the simulation banner spans the panel.

## Interaction pass · pointer depth, settling counters, staggered lists

- Added `depth.js`: a delegated pointer listener that gives glass surfaces a
  capped 2.4-degree lean, a pointer-tracking specular highlight, and a press
  veil that starts from under the finger. Guarded by an `@supports` check for
  3D transforms and removed outright under reduced motion.
- Added `counter.js`: detected-change tallies settle into place instead of
  snapping. `data-value` carries the authoritative number from the first
  frame and only whole numbers are ever rendered.
- Added `reveal.js`: change and history rows ease up into view on a capped
  stagger. Rows are appended complete and interactive first; the stagger is
  applied afterwards and never hides a row.
- Interaction polish across tally tiles, context badges, message presets,
  document facts, the saved preview, navigation, change rows, branch cards,
  notices, tool sheets, the scrollbar and the keyboard focus ring.
- The panel header is now sticky, so the branch and document stay in view.
- Each test suite runs as its own CI check, so a red check names the
  functionality that broke.
- Added `verify:panel-escaping`: a TypeScript-AST gate that proves every
  interpolation into panel markup is escaped or provably constant, and that
  the escaper it trusts really escapes. It has its own suite, with fixtures
  that prove it rejects an unescaped interpolation and a weakened escaper.
- Fixed five interpolations the new gate found: two review counts and a demo
  count now pass through `escapeHtml`, and the change-row category and status
  are ternaries over literals rather than a lookup.


## 0.2.0 — unreleased development

Hardening candidate for the Photoshop version workflow. This entry describes changes under verification, not a declaration of release acceptance.

- Read a version's committed preview back through a new `versionPreview` helper operation, so History, Branches and Reviews show the artwork actually saved rather than metadata alone. The engine verifies the PNG header and the committed size, caps the blob so its encoded form fits the bridge, and the panel re-checks the reported type, size and encoding before building an image URL itself.
- Rebuild the panel around cards: project, branch and document in one context card; navigation as a rail card with icons above labels; detected-change tiles counted from the categories the scan already reports.
- Add the glass material, a rounder geometry scale, and interaction that eases in and settles out. The press veil darkens rather than lightens, which keeps every label above the contrast floor.
- Fix `wideWorkspace()` relying on `window.matchMedia`, which UXP host builds do not all implement; the wide inspectors were unreachable in Photoshop even though the stylesheet had switched.
- Add `verify:tokens` and `verify:assets`, which catch design tokens declared without use and panel/demo asset versions drifting apart. The latter had been silently serving stale styles to browser verification.
- Tighten spacing so no content sits on a card's border, and correct icon glyph insets that left icons a few pixels out from their labels.

- Tighten logo/title alignment and panel spacing, remove redundant scan/save controls, and add a searchable command palette plus an in-panel Docs directory. Preserve mutation guards and confirm sync/branch-switch commands.
- Include Adobe's explicitly requested `@1x` icon variant in packaging and manifest checks.

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
