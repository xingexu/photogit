# PhotoGit September 10 MVP

The deadline build proves one complete, trustworthy workflow inside Photoshop:

1. Track the active Photoshop document in a local project folder.
2. Capture a canonical layer manifest and an exact PSD snapshot.
3. Commit both artifacts to a real local Git repository.
4. Detect and explain unversioned layer changes.
5. Display the Git version history in the Photoshop panel.
6. Open any historical PSD as a separate Photoshop document.
7. Create and switch local branches without discarding unversioned work.

## Deliberately deferred

- Remote authentication and push/pull.
- Git LFS for large production documents.
- Automatic PSD merge materialization.
- Pixel-perfect visual comparison.
- Permanent cross-document UUID metadata.

These are next-stage features. The deadline build should never claim to merge data that it cannot preserve safely.

## Demo script

1. Start the helper with `node helper/server.mjs`.
2. Load `uxp-plugin/manifest.json` in Adobe UXP Developer Tool.
3. Open a Photoshop document and choose **Plugins → PhotoGit**.
4. Select **Track this document** and choose an empty project folder.
5. Make a visible Photoshop change, then select **Refresh** in PhotoGit.
6. Open **Changes** to show the semantic diff.
7. Select **Save version**, enter a message, and show it in **History**.
8. Make and save another change.
9. Select **Open** beside the first version to reopen the exact earlier PSD.
