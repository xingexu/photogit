# PhotoGit 0.2.0 development quick start

This is a local developer setup, not a packaged end-user installer. Test with disposable artwork first. The helper, panel, and packages should all come from the same 0.2.0 checkout.

## Prepare a project

Install Node.js 22 or newer, Git 2.40 or newer, Git LFS, Photoshop, and Adobe UXP Developer Tools. From the PhotoGit source directory:

```sh
npm ci
npm run build
npm run photogit -- init /absolute/path/to/design-project
git -C /absolute/path/to/design-project lfs install --local
```

Git needs an author identity to save versions. If it is not already configured, set your real identity for this project:

```sh
git -C /absolute/path/to/design-project config user.name "Your Name"
git -C /absolute/path/to/design-project config user.email "your-address@example.com"
```

Use a dedicated project folder for one Photoshop document. An ordinary Git repository is not a PhotoGit project until `init` creates valid `.photogit` metadata. Do not choose the PhotoGit source checkout as your artwork project.

## Start and pair the helper

```sh
npm run helper -- --approve-root /absolute/path/to/design-project
```

Keep this terminal process running. Its startup output identifies approved roots and the local port. It stores configuration in `~/.photogit/helper.json` and a private, Git-ignored pairing file at `<project>/.photogit/helper.json`. Do not copy either into an issue or chat. Requests pass through `<project>/.photogit/bridge/`; do not edit its files manually while the helper runs.

In another terminal, from the source directory:

```sh
npm run photogit -- doctor /absolute/path/to/design-project
```

Read every diagnostic. Invalid project structure or required Git/LFS checks cause failure. Missing Photoshop, helper availability, and fresh-project pairing are separate notices; a valid project does not establish that the panel has folder permission. The health endpoint is separate from panel pairing.

For an isolated configuration, set `PHOTOGIT_HELPER_CONFIG` to a private file outside Git and start the helper with that environment variable. Reuse the same configuration when restarting. Do not run duplicate helpers for the same configuration.

If a different service owns the HTTP port and you only need the Photoshop filesystem bridge, add `--bridge-only`. The panel still uses the bridge; the loopback health endpoint is not started in this mode. Do not use this to bypass the same-configuration helper lock.

## Load and place the panel

1. In Photoshop's plugin settings, enable developer mode if your Photoshop version requires it, then restart Photoshop.
2. Open Adobe UXP Developer Tools and add `apps/photoshop-plugin/manifest.json` from this checkout.
3. Load PhotoGit, then choose **Plugins → PhotoGit → PhotoGit** in Photoshop.
4. Drag the PhotoGit panel tab into your preferred dock. Photoshop owns this placement; the plugin does not dock itself.
5. Choose the initialized project folder and grant folder access.
6. Open a saved PSD in Photoshop and connect that intended document. If the panel reports a different document, reconnect the intended PSD or explicitly adopt the replacement only when it belongs in this project.
7. Scan, review the changes, enter a version message, and choose **Save version**.

## Daily work

Edit the connected document. PhotoGit scans Photoshop notifications, and you can request a scan to inspect changes. Wait for the scan to complete and inspect its result before saving a version. Saving records the PSD and supported metadata. Use History to inspect earlier versions and open an earlier PSD separately. To make an earlier state current, verify the opened copy and deliberately save it as a new version; never discard the original open document without checking your work.

Appearance comparison uses sampled previews and can miss tiny edits; inspect important visual changes in Photoshop. If an older version has no document-composite baseline, PhotoGit shows a comparison-limit warning instead of inventing a dirty state. Save a new version to establish that baseline. Large scans check a 30-second budget between batches, but an in-flight Photoshop call may take longer; Cancel discards stale results when the host yields rather than forcibly stopping every host call.

Before switching, pulling, or merging, save work you want to keep. A branch operation can change Git and then fail to open the resulting PSD. Read the recovery message, refresh project status, and open the recorded snapshot before continuing. Do not repeat a mutating operation blindly after a timeout.

Reviews show the base and incoming branch. **Git merge** is an ordinary Git merge; independently changed PSDs require manual reconciliation in Photoshop. **View conflicts** reports actual conflicting paths. **Open GitHub comparison** opens GitHub only for GitHub remotes and does not create a pull request automatically.

## Troubleshooting

| Symptom | Next step |
| --- | --- |
| Helper offline | Start the helper with the same approved project root; reconnect or retry the panel. |
| Duplicate helper or occupied port | Read the diagnostic. Use the intended helper or stop the stale process you started; do not start repeated copies. |
| Pairing missing or access denied | Confirm the helper approved this exact project and choose that folder again. Do not paste tokens. |
| Different active document | Return to the connected PSD or use the explicit reconnect/adopt flow. |
| No changes after an edit | Confirm the active document and scan state. Request a scan; inspect warnings for unsupported or failed appearance capture. |
| Snapshot unavailable | Check the version and local Git LFS objects. Fetch missing LFS data through your normal authenticated Git workflow, then retry opening. |
| Git changed but PSD did not open | Refresh project status, inspect the current branch, and follow snapshot recovery instructions before editing further. |
| Merge conflict | Inspect listed files. Reconcile competing PSD work manually; PhotoGit cannot apply its semantic merge plan to Photoshop. |

Report failures with sanitized doctor output, Photoshop/OS versions, exact actions, and panel activity. Never include tokens, credential URLs, or private artwork.
