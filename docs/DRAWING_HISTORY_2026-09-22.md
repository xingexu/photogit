# Drawing detection and visual version history

PhotoGit now supplements its legacy 64-pixel thumbnail digest with full-resolution
rendered-pixel fingerprints. Layers and the document composite are read in bounded
512-pixel tiles, retaining native component precision and alpha. A changed pixel
can therefore be detected even when the small thumbnail is unchanged. Reads are
cancelable and image buffers are disposed after each tile. Unsupported layer
types retain composite-level comparison; internal PSD data is preserved in the
snapshot. This is rendered comparison, not exhaustive inspection of Photoshop's
internal state.

Photoshop notifications and history-state observation continue to schedule scans
after editing pauses. Scanning does not create a version: **Save version** records
the checkpoint. Old checkpoints retain thumbnail comparison until a new version
establishes the full-resolution baseline, with an explicit migration notice.

History adds saved-artwork thumbnails, before/after previews against the selected
commit's actual first parent, unique added/deleted/edited layer totals, and readable
before/after metadata values. Missing artwork degrades to version metadata. Only
the eight newest list thumbnails are loaded; selecting any older version loads
its preview separately. Demo images remain explicitly illustrative.

Saved previews use bounded RGB/RGBA PNGs with a maximum dimension of 768 pixels,
keeping even an uncompressed preview below the helper's 4 MiB transport limit.
The original PSD remains full size. Preview capture, pixel fingerprints and PSD
export share one Photoshop modal operation.

## Verification

- TypeScript build and all 479 tests across 26 files passed.
- Host-mocked tests cover tiny edits missed by the old sample, eraser reversal,
  tiled native-depth capture, cancellation/disposal and atomic snapshot capture.
- Real helper/Git integration covers legacy baseline migration, saving a painted
  change, inspecting its parent and edits, clean rescan, and eraser detection.
- PNG output independently checked using Node's inflate and CRC implementations,
  including RGB/RGBA bytes, alpha preservation and maximum preview size.
- Browser interaction checks passed in both themes, including saving, inspecting
  history, docking, keyboard navigation, filters and draft/focus preservation.
- Version history passed at 230×200, 320×600, 420×800 and 1400×1000 in both themes:
  loaded images, before/after labels, layer totals and no horizontal overflow.
- Panel DOM safety, markup escaping, design tokens and shared asset stamps passed.
- Development source bundle rebuilt and verified against source bytes.

Native Photoshop acceptance remains pending. The panel was loaded before these
edits, but macOS denied assistive access for reload automation. Reload the updated
panel through UXP Developer Tools and restart the built helper, then use a test PSD
to save a baseline, draw, scan, save and inspect history, erase, and scan again.
Large documents and unsupported layer types still need native performance and
coverage checks. No user artwork was modified during this work.
