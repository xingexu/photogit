# Development setup

## Prerequisites

- macOS with Photoshop 2025 or 2026
- Node.js 22 or newer
- Git 2.40 or newer
- Git LFS before testing PSD remotes
- Adobe UXP Developer Tool from Creative Cloud

## Build and test

```sh
npm install
npm test
npm run photogit -- doctor .
```

## Exercise the CLI capture flow

```sh
mkdir ~/Documents/photo-project
npm run photogit -- init ~/Documents/photo-project
cp packages/test-fixtures/captures/basic-document.json ~/Documents/photo-project/.photogit/capture.json
cd ~/Documents/photo-project
/path/to/photogit/cli/dist/main.js save -m "First design"
```

The capture file is ignored by Git; only canonical domain files are committed.

## Start the helper

The helper creates a random token in `~/.photogit/helper.json`, stored with mode `0600`. Approve only explicit project roots:

```sh
npm run helper -- --approve-root ~/Documents/photo-project
```

The helper writes a local pairing file to `.photogit/helper.json` inside each approved project. The file is mode `0600`, ignored by Git, and read automatically after the user grants the panel access to that project folder. Authenticated requests and responses pass through `.photogit/bridge/`, which is also ignored by Git. There is no token to paste into Photoshop or chat and no insecure HTTP permission in the plugin.

## Load the Photoshop panel

1. Open Adobe UXP Developer Tools.
2. Add the plugin using `apps/photoshop-plugin/manifest.json`.
3. Load the plugin and open PhotoGit from Photoshop's Plugins menu.
4. Choose the initialized project folder in the panel.
5. Open an RGB 8-bit PSD and save a named version.

The panel exports temporary artifacts to `.photogit/incoming/`. The helper atomically moves copies into their tracked locations; incoming files, pairing data, and transaction journals are ignored.

Do not package a release while the manifest uses `com.photogit.development`. Adobe requires the permanent Developer Distribution ID in a distributable plugin.
