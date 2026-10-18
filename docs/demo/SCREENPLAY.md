# PhotoGit demo: screenplay

A real recording of PhotoGit being installed and used in Photoshop 2026 on macOS. Nothing is mocked: the terminal commands run, the plugin loads through Adobe UXP Developer Tools, and every panel action is a real helper and Git operation on a throwaway project.

- **Length:** about 4 minutes
- **Format:** 1920×1080, 30 fps, H.264, captions burned in, original ambient music bed
- **Project:** `~/PhotoGitDemo/poster` with a local "team" remote at `~/PhotoGitDemo/shared.git`
- **Covers:** installation, the five panel sections, Docs, and all 19 palette commands plus the `/commit` alias

The panel part of the take is scripted in [`scripts/demo/panel-take.js`](../../scripts/demo/panel-take.js). Each beat below matches a beat id there, and its caption is placed at the moment that beat starts.

## Act 1: Install (about 50 s)

| # | Shot | On screen | Caption |
| --- | --- | --- | --- |
| 1 | Title card | PhotoGit logo on the pixel-art sky. "Version control for Photoshop." | |
| 2 | Terminal | `git clone https://github.com/xingexu/photogit.git` then `cd photogit && npm ci && npm run build` (install output sped up) | Install PhotoGit from GitHub. |
| 3 | Terminal | `npm run photogit -- init ~/PhotoGitDemo/poster` | Create a project folder for your artwork. |
| 4 | Terminal | `git -C ~/PhotoGitDemo/poster remote add origin ~/PhotoGitDemo/shared.git` | Optional: add a shared remote, such as a GitHub repo. |
| 5 | Terminal | `npm run photogit -- doctor ~/PhotoGitDemo/poster` | `doctor` checks Git, Git LFS and the project. |
| 6 | Terminal | `npm run helper -- --approve-root ~/PhotoGitDemo/poster` (left running) | Start the local helper. It's the only part that runs Git. |
| 7 | UXP Developer Tools | Workspace list, **Load** on PhotoGit | Load the panel with Adobe UXP Developer Tools. |
| 8 | Photoshop | **Plugins → PhotoGit → PhotoGit**, the panel opens, **Connect a project**, choose `poster` (the `/connect` command) | Open the panel and connect the project. That's all the terminal you'll need. |

## Act 2: Track and save (about 70 s)

| # | Beat | On screen | Caption |
| --- | --- | --- | --- |
| 9 | `panel-ready` | Empty Changes tab | PhotoGit lives in a panel inside Photoshop. |
| 10 | `poster-built` | A poster is built in Photoshop: rules, moon, mountain, three text layers. The Changes list fills automatically. | It watches Photoshop and lists edits as you work. |
| 11 | `scan` | Palette opens, `/scan` typed | Press / to open the command palette. /scan checks for edits on demand. |
| 12 | `filters` | Text, then Visual, then All filter chips | Filter edits by Text, Visual or Structure. |
| 13 | `first-save` | "Editorial poster baseline" typed in the composer, **Save version**, History opens | Save version stores the exact PSD with a note. |
| 14 | `edit-detected` | `/changes`; headline becomes FUNCTION, moon opacity 78%, "V.02" added; the edits are listed | Every edit is named, down to the layer and property. |
| 15 | `save-command` | `/save Refined headline and moon` | Or save straight from the palette with /save. |

## Act 3: History (about 40 s)

| # | Beat | On screen | Caption |
| --- | --- | --- | --- |
| 16 | `history-search` | `/history`, search "moon" | /history lists every version. Search by note. |
| 17 | `history-inspect` | Latest version selected, **What this version changed** sheet with before/after previews | See exactly what a version changed, with previews. |
| 18 | `history-compare` | First version selected, **Compare** with the open document | Compare any version with the document you have open. |

## Act 4: Branches and merging (about 70 s)

| # | Beat | On screen | Caption |
| --- | --- | --- | --- |
| 19 | `branch` | `/branch bold-moon`, Branches tab | /branch starts a new direction without touching the original. |
| 20 | `branch-edit` | A blossom-pink moon and "V.03" | Try something bold on the branch. |
| 21 | `commit-alias` | `/commit Bold blossom moon` | /commit works too, the same as /save. |
| 22 | `branches-tab` | `/branches` | /branches shows every direction and its latest version. |
| 23 | `switch` | `/switch main`, confirm; main's saved PSD opens | /switch opens that branch's saved PSD. Nothing is overwritten. |
| 24 | `second-branch` | `/branch quiet-type`, headline "LESS BUT BETTER", `/save`, `/switch main` | A second idea, on its own branch. |
| 25 | `compare` | `/compare bold-moon` sheet | /compare shows how a branch differs, layer by layer. |
| 26 | `merge` | `/merge bold-moon`, review, **Combine branch**; merged PSD opens | /merge combines a branch after you review it. |
| 27 | `reviews` | `/reviews`, quiet-type card expanded with its conflicts | /reviews shows what's ready to merge and what conflicts. |
| 28 | `conflicts` | `/conflicts` | Conflicting PSD edits are blocked, never silently overwritten. |

## Act 5: Share and project tools (about 50 s)

| # | Beat | On screen | Caption |
| --- | --- | --- | --- |
| 29 | `tag` | `/tag`, "v1.0", **Create** | /tag gives a version a memorable name. |
| 30 | `push` | `/push`, confirm | /push shares your saved versions with your team. |
| 31 | `pull` | `/pull`, confirm | /pull brings in versions others shared. |
| 32 | `activity` | `/activity` log | /activity is a log of everything PhotoGit did. |
| 33 | `status` | `/status` Project information sheet | /status shows project and connection details. |
| 34 | `reconnect` | `/reconnect` | /reconnect retries the helper connection. |
| 35 | `docs` | `/docs`, search "merge" | /docs is a searchable directory of every command. |
| 36 | `finale` | `/history` with the full history | |
| 37 | End card | "Free and open source. github.com/xingexu/photogit. Star the repo." | |

## Command coverage

| Command | Beat |
| --- | --- |
| `/connect` | 8 (choose project folder) |
| `/changes` | 14 |
| `/scan` | 11 |
| `/save`, `/commit` | 15, 24 · 21 |
| `/history` | 16, 36 |
| `/branch` | 19, 24 |
| `/branches` | 22 |
| `/switch` | 23, 24 |
| `/compare` | 25 |
| `/merge` | 26 |
| `/reviews` | 27 |
| `/conflicts` | 28 |
| `/tag` | 29 |
| `/push`, `/pull` | 30, 31 |
| `/activity` | 32 |
| `/status` | 33 |
| `/reconnect` | 34 |
| `/docs` | 35 |

## Recording it again

1. Close or save every Photoshop document, and leave the Mac alone for the take.
2. Run the install scene in a clean Terminal window, then load the plugin in UXP Developer Tools and start **Debug** (the take is driven through the debug socket).
3. Install and run the take, polling until it reports `done`:

   ```sh
   node scripts/photoshop-panel-evaluate.mjs --file scripts/demo/panel-take.js
   node scripts/photoshop-panel-evaluate.mjs 'window.__photoGitDemoTake.run()' --no-await
   node scripts/photoshop-panel-evaluate.mjs 'JSON.stringify(window.__photoGitDemoTake.status())'
   ```

4. Save the `status()` output as `beats.json` next to the raw recording, then run `scripts/demo/edit.sh` to cut, caption, score and export the final video.
