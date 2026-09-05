# Contributing

PhotoGit 0.2.0 is an unreleased development build. Discuss large behavior or schema changes in an issue. Keep changes scoped and add behavioral tests for persistence, bridge lifecycle, identity, cancellation, and recovery paths that change.

Use Node.js 22 or newer, Git 2.40 or newer, and Git LFS. Install with `npm ci`, then run:

```sh
npm run check
npm run build
npm test
npm run verify:security
npm audit
npm run package:development
npm run verify:package
```

For UXP changes, also follow [the live acceptance matrix](docs/LIVE_ACCEPTANCE.md). A mocked panel or browser prototype cannot establish Photoshop correctness. Report untested environments and unresolved failures directly. Use “version” in the UI; reserve “Git commit” for technical explanations.

Development archives keep the `com.photogit.development` ID. They are unsigned source bundles for UXP Developer Tools, not installable or published `.ccx` releases. Do not change repository settings, publish, or merge without maintainer authorization.

Never add real artwork, credentials, access tokens, or private document metadata to fixtures.

Read [SECURITY.md](SECURITY.md) for vulnerability reports and [the code of conduct](CODE_OF_CONDUCT.md) for participation expectations.
