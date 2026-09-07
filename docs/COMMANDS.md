# PhotoGit command directory

Click **Commands** in the panel header. Search by name or type a command, then press Enter. The leading slash is optional. Escape closes the palette; arrows browse results. The **Docs** tab contains the same searchable command registry and setup instructions.

The panel handles `/` outside text fields and Cmd/Ctrl+K when it receives those key events. Shortcuts never replace an open dialog/menu or interrupt startup or an exclusive operation. These are panel-local listeners, not registered Photoshop-wide shortcuts. Photoshop can intercept keys (including Cmd+K for Preferences), so **Commands** remains the reliable entry point. Browser keyboard tests do not establish physical-keyboard behavior inside Photoshop.

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

Command dispatch, argument validation, aliases, keyboard navigation, modal focus, busy guards, and sync confirmations are exercised against production JavaScript with mocked Photoshop/UXP. The September 7 Studio redesign also has browser coverage for display filters, shortcut navigation, simulated saves, version inspection and both themes. Prior native results apply to earlier revisions; the current redesign still needs live Photoshop visual and physical-keyboard acceptance.
