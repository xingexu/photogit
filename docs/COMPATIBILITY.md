# Compatibility: 0.2.0 development

Declared host minimums are not tested-support guarantees. Record real results in [ACCEPTANCE_REPORT.md](ACCEPTANCE_REPORT.md); do not carry old screenshots forward as proof for this revision.

| Environment | Declaration or requirement | Evidence boundary |
| --- | --- | --- |
| Node.js | 22 or newer | Headless baseline on Node 24.4.1; CI configured for 22 and 24. |
| Git | 2.40 or newer | Local baseline Git 2.48.1. |
| Git LFS | Required for complete PSD sharing | Local baseline Git LFS 3.8.0; remote authentication remains user-managed. |
| Photoshop | Manifest minimum 25.0.0, UXP API version 2 | Conservative declared floor, not verified compatibility with every version at or above it. |
| Photoshop 2025 | Candidate target | Not declared verified by this work. |
| Photoshop 2026 | Native workflow tested on 27.10.0 | See acceptance report for operations actually exercised and remaining native visual gates. |
| macOS | Native workflow exercised in Photoshop 27.10.0 | Existing folder grant reused; fresh permission flow and full visual matrix are still unverified. |
| Windows | Not currently verified | Headless portability does not establish Windows UXP/helper installation support. |
| Linux | Headless packages and CI | No Photoshop panel host support. |

The previous 24.2 declaration was too broad for this panel's `photoshop.imaging` usage. Adobe describes the 24.2 imaging API as beta and records the move from `imaging_beta` to `imaging` in the 24.4 beta build. PhotoGit therefore declares a conservative 25.0.0 floor; that choice does not substitute for testing Photoshop 25.x itself. [Adobe Photoshop API changelog](https://developer.adobe.com/photoshop/uxp/ps_reference/changelog/)

| Document change | Detection | Limit |
| --- | --- | --- |
| Add, delete, rename, reorder, reparent layers | Structural metadata comparison | Automatic add, rename, and reorder plus native deletion detection observed in 27.10.0; reparenting remains unverified. |
| Visibility, opacity, fill, blend mode | Appearance property comparison | Hide and opacity observed in 27.10.0; fill/blend coverage remains limited. |
| Movement, transform, bounds | Captured property/bounds changes | Movement observed; not a complete editable transform history or exhaustive transform coverage. |
| Basic text contents | Text property comparison | Text edits observed in 27.10.0; not every typography property is captured. |
| Painted pixels | Rendered fingerprint comparison | A native painted edit was detected; sampling cannot prove every tiny edit or identify the tool used. |
| Groups | Structural/appearance metadata plus a whole-document composite | Direct group imaging is unsupported. Group-opacity/composite changes were detected and saved in 27.10.0; additional group masks/effects remain unverified. |
| Shapes, smart objects, masks, effects, adjustments | Supported layer imaging plus a whole-document composite | Unsupported opaque layer reads fall back to the composite. These advanced native cases remain unverified. No independent reconstruction or automatic apply. |
| RGB 8-bit documents | Primary capture target | Other modes/depths require separate host validation. |
| PSD snapshot | Exact saved artifact | Needs a valid local PSD/LFS object and Photoshop acceptance to open. |

The semantic three-way merge planner reasons about supported metadata in isolation. The Photoshop workflow uses ordinary Git merges and conservatively blocks competing PSD changes. It does not apply a semantic merge plan to a live document. The PSD remains authoritative for unsupported content.

Older saved versions can lack the optional document-composite fingerprint. Its new availability is not treated as a design edit. The panel displays a comparison-limit warning until a new version establishes that baseline; zero layer changes alone must not imply that an old version's group/effect rendering was compared. The native group test verified the warning disappeared and the count returned to zero after saving a new baseline. If a current capture has no composite fingerprint, the helper also warns that document rendering was not compared and asks for the panel to be updated/reloaded.

Fingerprints use a 64-pixel target sample rather than every PSD pixel. They can miss small rendered changes. The 30-second scan budget is checked between layer batches, not a hard timeout for an in-flight Photoshop call or the final document-composite read.
