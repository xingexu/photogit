# Release checklist: 0.2.0 development

No GitHub settings, publication, force-push, history rewrite, or merge into main is authorized by preparing this checklist. The development archive is not a public release artifact.

## Local acceptance

- [ ] Reproduce documented setup from a fresh dependency install and disposable project.
- [ ] Run check, build, tests, dependency audit, source secret inventory, and package verification on the final revision.
- [ ] Run every native scenario and size/scale/state combination in [LIVE_ACCEPTANCE.md](LIVE_ACCEPTANCE.md); record actual evidence.
- [ ] Review security tests for authentication, malformed input, bounds, containment, symlinks, command arguments, timeout races, and log redaction.
- [ ] Confirm there are no unintended working-tree changes or generated pairing/project files in the patch.
- [ ] Confirm one 0.2.0 product version across packages, lockfile, manifest, docs, and development artifact names.
- [ ] Obtain the permanent Adobe plugin ID, create a real CCX package with Adobe tooling, and verify installation on a clean machine.
- [ ] Validate a distributable helper startup/upgrade/uninstall path; the current helper is a development Node command.

The September 4–5 hardening ledger records 210 passing tests and passing check/build/security/package verification, but does not close these broader release gates. A final repeat of the npm network audit was denied because it sends dependency metadata externally; authorization is required to retry it. The earlier audit passed with the unchanged dependency lock. Native debugger recovery also requires user permission before restarting Photoshop, after personal work is saved; see [the recovery steps](LIVE_ACCEPTANCE.md#resume-the-blocked-native-session).

## Repository settings recommendations — authorization required

1. Protect `main` with required pull requests, at least one independent review, dismissal of stale approvals, resolved discussions, and passing CI checks for Node 22/24 on macOS/Linux plus dependency audit. Require checks on the latest reviewed revision.
2. Block force pushes and branch deletion; apply protections to administrators except an explicitly documented emergency process. Require a linear history only if that matches the maintainer's merge policy.
3. Enable GitHub private vulnerability reporting and update SECURITY.md after confirming it works. A verified email route is available meanwhile.
4. Enable Dependabot security updates. The checked-in configuration schedules version updates but does not change repository settings by itself.
5. Keep secret scanning and push protection enabled. Review additional secret patterns and validity checks for this project's needs.
6. Use read-only workflow permissions by default. Keep release credentials out of pull-request workflows, require approval for release environments, and pin action revisions according to the maintainer's update policy.

Read-only inspection on September 4, 2026 found a public repository with private vulnerability reporting disabled, Dependabot security updates disabled, and secret scanning/push protection enabled. No settings were changed.

## Assets and publication

The supplied original `photogit.png` and historical artwork remain user-owned source material. Development packaging includes only referenced runtime assets, excluding unused duplicates. Do not rewrite Git history merely to remove existing large blobs. If removing duplicate working-tree assets, first verify byte identity and all runtime/manifest/test references, preserve the canonical original, and record the removal.

The local hardening patch removed thirteen proven duplicate legacy aliases using a recoverable move. See [ASSET_CLEANUP.md](ASSET_CLEANUP.md) for exact targets, retained sources, and the local backup location.

Replace old marketing screenshots only with current, verified native Photoshop captures. A release announcement must state actual supported Photoshop/OS versions, the helper requirement, ordinary Git merge limitations, and the current private security route. Prepare publication only after every local acceptance gate passes; obtain explicit authorization for external actions.
