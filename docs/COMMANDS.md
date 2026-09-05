# PhotoGit command directory

Click **Commands** in the panel header. Search by name or type a command, then press Enter. The leading slash is optional. Escape closes the palette; arrows browse results. The **Docs** tab contains the same searchable command registry and setup instructions. Native testing found modifier-key combinations intercepted or not delivered by Photoshop, so no modifier shortcut is advertised or registered. Cmd+K remains Photoshop Preferences.

| Command | Result |
| --- | --- |
| `/changes`, `/history`, `/branches`, `/reviews`, `/activity`, `/docs` | Navigate to that section. History focuses its search field. |
| `/scan` | Scan the connected document. |
| `/save Refined title` | Save an exact PSD version with that message. `/commit` is an alias. |
| `/branch cover-b` | Create and switch to a new branch. |
| `/switch cover-b` | Confirm switching before opening the branch's saved PSD. |
| `/compare cover-b` | Show semantic and file differences against the current branch. |
| `/merge cover-b` | Review the current comparison and confirm an ordinary Git merge. Conflicts remain blocked. |
| `/tag` | Open the tag form. |
| `/status` | Inspect project and helper information. |
| `/connect` | Choose a project folder. |
| `/reconnect` | Retry the current project's helper. |
| `/conflicts` | View conflicting files. |
| `/pull`, `/push` | Ask for confirmation before syncing with the project's configured remote. |

**Enter in the version-message field** saves that version. Existing confirmation dialogs are not replaced by shortcuts. Save still requires a message, a responding helper, and the correct connected document. Commands are a fixed dispatcher, not a shell; arbitrary code is never evaluated.

Enter a complete message after `/save`. For branch commands, use the exact Git branch name without quotes. Maximum message length is 500 characters; branch arguments are limited to 200. Unknown commands, missing arguments, and commands issued during an exclusive operation are rejected.

## Terminal setup—not palette commands

From the PhotoGit source checkout, replace the example path:

```sh
npm run photogit -- init "/path/to/project"
npm run helper -- --approve-root "/path/to/project"
npm run photogit -- doctor "/path/to/project"
```

Save work you want to keep before branch operations. Earlier PSDs open separately. A merge does not blend Photoshop layers, and sampled appearance comparisons can miss tiny edits. See [Quick start](QUICK_START.md).

## Verification scope

Command dispatch, argument validation, aliases, keyboard navigation, modal focus, busy guards, and sync confirmations are exercised against production JavaScript with mocked Photoshop/UXP. Native Photoshop checks cover the revised panel, opening the palette, and navigating with `/docs`; these do not claim a new native save/merge command acceptance run or the complete size/scale matrix.
