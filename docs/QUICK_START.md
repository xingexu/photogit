# PhotoGit development quick start

PhotoGit follows VIT's model: setup happens once, then daily version-control work happens in the editor panel.

## One-time setup

```sh
cd /path/to/photogit
npm install
npm run photogit -- init /path/to/your/design-project
npm run helper -- --approve-root /path/to/your/design-project
```

Leave the helper running while Photoshop is open. A packaged background helper will replace this development command before public release.

## Load in Photoshop

1. Install and open Adobe UXP Developer Tools.
2. In Photoshop, open **Photoshop > Settings > Plugins**, enable **Developer Mode**, click **OK**, and restart Photoshop.
3. Add `/path/to/photogit/apps/photoshop-plugin/manifest.json`.
4. Start Photoshop 2026, then choose **Load** beside PhotoGit in UXP Developer Tools.
5. In the PhotoGit panel, choose the initialized design-project folder.

## Daily workflow

1. Pull.
2. Choose or create a branch.
3. Edit in Photoshop.
4. Refresh to review layer-level changes.
5. Write a message and Save version.
6. Push to share it.

PhotoGit refuses branch switches and pulls while the Git project contains unsaved project changes. A successful switch opens the selected branch's PSD snapshot as a new document, leaving the current Photoshop document untouched.
