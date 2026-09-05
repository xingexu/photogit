# Recoverable duplicate icon cleanup

On September 4, 2026, thirteen unreferenced legacy PNG aliases were removed from the working tree after SHA-256 comparison and reference searches across the manifest, actual panel, demo, scripts, tests, and documentation. No screenshot, video, original logo, or Git history was removed.

Binary deletion through the patch tool was unavailable, so these exact files were moved into this local recovery directory:

`/private/tmp/photogit-duplicate-icons-UGCj7t/`

The backup is temporary and can be cleaned by the operating system. The original files also remain recoverable from starting commit `17dc4eef0823efbdefd0d77102cfcc6a072cada1`; Git history was not rewritten. To undo an individual removal locally, copy its named PNG from the backup into `apps/photoshop-plugin/icons/`.

| Retained identical source | Removed duplicate aliases |
| --- | --- |
| `photogit-dark.png` | `photogit-dark@1x.png`, `photogit-git-dark.png`, `photogit-git-dark@1x.png`, `photogit-git-light.png`, `photogit-git-light@1x.png`, `photogit-light.png`, `photogit-light@1x.png` |
| `photogit-dark@2x.png` | `photogit-dark.svg.png`, `photogit-git-dark@2x.png`, `photogit-git-light@2x.png`, `photogit-light.svg.png`, `photogit-light@2x.png` |
| `photogit-git-mark.png` | `photogit-logo.png` |

The original root `photogit.png` and current `icons/photogit.png`, `icons/photogit-pg.png`, and `icons/photogit-pg@2x.png` were preserved. The old SVG wrappers still reference `photogit-git-mark.png`, so that source was retained. Canonical old 1x/2x PNGs were also retained; cleanup removed only proven duplicate aliases. The development package uses the current manifest and includes only its referenced assets.
