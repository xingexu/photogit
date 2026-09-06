# Security audit — September 6, 2026

Baseline: `8b93d8ca4d992398909ede5cdd15419ae1650a6e`. This is a scoped engineering audit, not a penetration-test certification or a guarantee against data loss. No private project files, credentials, or native screenshots are included in this report or push.

## Results

| Check | Result |
| --- | --- |
| `npm audit --json` | Zero known vulnerabilities in the reported dependency graph (145 total). |
| `npm audit signatures` | 75 packages with verified registry signatures; 36 with verified attestations. This is not a claim that every dependency has provenance. |
| `npm run verify:security` | 111 baseline text files checked; 112 including this report on the final rerun; 199 binary files excluded; no known-pattern findings. |
| Local reachable Git history | 799 objects enumerated; 385 text objects checked with the source inventory's patterns; 182 binary objects excluded; no oversized exclusions or findings. Includes commit/tag text and historical pairing-file path checks. |
| Regression suite | All 280 tests passed locally on macOS / Node 24. Includes security, helper, Git, protocol, UI, and recovery tests. |
| Types and package integrity | Passed. 13-file development bundle matches source; SHA-256 `9f68faf2e9352dfdd345d53aba8dcf6406f7f0cd82869a2b9150cce3d3ba26c7`. |

The history check used `git rev-list --objects --all` and `git cat-file`, locally, with the existing inventory's known patterns. Only object IDs and rule names could be reported; no matching values were printed. Synthetic credential-URL test fixtures were excluded exactly as in the source inventory. Binary images, PSDs, archives, ignored files, unreachable objects, unknown secret formats and remote-only hidden refs are outside this scan. No OCR or forensic recovery was performed.

## Reviewed protection boundaries

- **Plugin permissions:** explicit folder access and HTTPS external-link launch; no broad network/domain permissions in the manifest. Dynamic layer/branch/version text is escaped or inserted as text. Helper responses are schema/bounds checked before use.
- **Helper:** loopback-only binding, Host allowlist, rejected browser-origin POSTs, bearer-token authentication with timing-safe comparison, rate limiting, no-store responses, bounded request/response sizes and redacted errors. Health is intentionally unauthenticated and contains no repository data.
- **Local files:** approved-root containment, real-path checks, symlink defenses, owner-only bridge directories and atomic mode-0600 pairing writes. Tests check concurrent requests, expiry, cancellation and cleanup.
- **Repository changes:** argument arrays rather than shell interpolation, validated names and snapshot paths, explicit staging allowlists, wrong-document rejection, PSD merge guards, rollback and recovery tests.
- **Limits:** Git hooks, filters, credential helpers and other same-user processes are trusted, not sandboxed. Bearer tokens and working PSDs are not encrypted by PhotoGit. Use OS disk encryption, trusted projects, credential-manager storage and independent backups. A public Git push exposes committed content; Git LFS is not an access-control or encryption system.

The default local helper configuration was absent during the live metadata check. A custom running helper's configuration and private project ACLs were not inspected; unit tests are not proof of the user's current filesystem permissions. No user PSD was changed or saved.

## GitHub protection gaps

The repository is public. Read-only GitHub API checks reported:

- Secret scanning and push protection: **enabled**.
- Main branch protection: **absent**; applicable branch rules API returned an empty list.
- Dependabot security updates: **disabled**. The alerts API also reported alerts disabled; its permission notice means alert contents could not be independently reviewed.
- Private vulnerability reporting: **disabled**. Use the contact in `SECURITY.md` until enabled.
- Secret-scanning non-provider patterns and validity checks: **disabled**.

Recommended maintainer follow-up: require reviewed pull requests and passing CI on main; enable dependency alerts/security updates and private reporting where available; consider immutable action-SHA pinning (CI currently uses major-version action tags). These are recommendations, not changes made by this audit. No access scopes were expanded.

## CI finding

The prior [GitHub run](https://github.com/xingexu/photogit/actions/runs/34006323216) passed dependency audit and three platform/runtime jobs, but failed the macOS / Node 22 late-response cleanup assertion. Its status response had been published before the worker's `finally` block removed the status request files. The test now waits up to five seconds for the request directory to empty, then still asserts no late response exists. This removes a scheduler race without changing production code or weakening the cleanup requirement. The subsequent push starts a new CI run; consult that run for hosted results.

## Remaining acceptance

No independent penetration test, malicious same-user race testing, binary-artifact privacy review, native Photoshop adversarial-input campaign, or Windows ACL validation was completed. No assertion is made that every user/client data case is protected. Continue treating 0.2.0 as an unreleased development build.
