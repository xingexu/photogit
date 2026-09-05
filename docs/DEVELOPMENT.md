# Development

PhotoGit 0.2.0 is an unreleased development build. Use the [quick start](QUICK_START.md) for real Photoshop pairing and the [live acceptance matrix](LIVE_ACCEPTANCE.md) for host verification.

## Headless setup

Use Node.js 22 or newer, Git 2.40 or newer, and Git LFS. CI runs Node 22 and 24 on Linux and macOS; this matrix is configured coverage, not evidence that an unrun workflow passed.

```sh
npm ci
npm run check
npm run build
npm test
npm run verify:security
npm audit
npm run package:development
npm run verify:package
```

Integration tests create disposable Git repositories. Helper tests bind loopback ports and use actual filesystem bridge files; an environment prohibiting loopback listeners must permit local tests or report that restriction. Native Photoshop capture, PSD opening, host rendering, and docking cannot be validated by these tests.

## CLI fixture flow

The fixture contains synthetic metadata, not a real PSD. This checks CLI serialization and Git behavior only:

```sh
npm run photogit -- init /absolute/path/to/disposable-project
git -C /absolute/path/to/disposable-project config user.name "PhotoGit Test"
git -C /absolute/path/to/disposable-project config user.email "test@photogit.invalid"
cd /absolute/path/to/disposable-project
node /absolute/path/to/photogit/cli/dist/main.js save \
  --capture /absolute/path/to/photogit/packages/test-fixtures/captures/basic-document.json \
  -m "First fixture version"
node /absolute/path/to/photogit/cli/dist/main.js log
```

Without `--snapshot`, this produces metadata history with no openable PSD. Use the real panel to capture complete document versions. An invalid ordinary Git repository must fail doctor; a valid project can still report missing host/helper prerequisites.

## Runtime boundaries

The panel is CommonJS UXP JavaScript. Shared packages, CLI, and helper compile through TypeScript project references. Tests loading the production panel in a simulated DOM exercise interactions, but do not emulate Photoshop imaging, UXP layout, filesystem prompts, or modal execution.

The helper accepts only approved roots. `.photogit/helper.json`, `.photogit/bridge/`, `.photogit/incoming/`, and transaction files are local working data and must stay ignored. Use `PHOTOGIT_HELPER_CONFIG` with an isolated temporary path for tests; do not reuse a real user's helper configuration.

## Development packaging

`package:development` gathers the manifest entrypoint and its local runtime, stylesheet, and icon dependencies, verifies product version consistency, and creates `release/photogit-0.2.0-development.zip`. `verify:package` independently checks the archive file list and extracted bytes against current source, runtime syntax, and the built CLI entrypoint. Stale archives fail verification after source changes; rebuild them.

The archive excludes the simulated demo, tests, unused artwork, project files, and secrets. It retains `com.photogit.development`. It is a source bundle for UXP Developer Tools, not an Adobe CCX package or helper installer. Native signing, Adobe distribution identity, clean-machine installation, and publication remain separate gates.
