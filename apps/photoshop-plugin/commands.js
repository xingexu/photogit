// Shared by the native palette and command directory. Never executed as shell code.
const commands = [
  ["changes", "Show changes", "Go to detected edits", "changes"],
  ["history", "Find a version", "Search saved versions", "history"],
  ["branches", "Show branches", "Switch branches", "branches"],
  ["reviews", "Show reviews", "Compare branches and combine them safely", "reviews"],
  ["activity", "Show activity", "See what PhotoGit has done this session", "activity"],
  ["docs", "Commands & docs", "Open this directory", "docs"],
  ["scan", "Scan document", "Check Photoshop for new edits", "scan"],
  ["save", "Save a version", "Save a complete copy of your PSD with a note", "save Refined typography", "commit"],
  ["branch", "Create branch", "Start a new direction and switch to it", "branch cover-option-b"],
  ["switch", "Switch branch", "Open that branch’s saved file (asks first)", "switch main"],
  ["compare", "Compare branch", "See how it differs from your current branch", "compare cover-option-b"],
  ["merge", "Combine a branch", "Review the differences, then combine (asks first)", "merge cover-option-b"],
  ["tag", "Create tag", "Give the current version a memorable name", "tag"],
  ["status", "Project information", "See project details and connection status", "status"],
  ["connect", "Change project", "Choose a different project folder", "connect"],
  ["reconnect", "Reconnect", "Retry the connection to this project", "reconnect"],
  ["conflicts", "View conflicts", "See which files couldn’t be combined", "conflicts"],
  ["pull", "Get shared versions", "Bring in versions others shared (asks first)", "pull"],
  ["push", "Share saved versions", "Send your saved versions to the shared project (asks first)", "push"]
].map(([id, label, description, example, alias]) => ({ id, label, description, example, alias }));
function parse(input) {
  const text = String(input).trim().replace(/^\//, "");
  const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(text);
  if (!match) return null;
  const command = commands.find(c => c.id === match[1].toLowerCase() || c.alias === match[1].toLowerCase());
  return command ? { command, argument: (match[2] || "").trim() } : null;
}
function search(query) {
  const needle = String(query).trim().replace(/^\//, "").toLowerCase();
  return commands.filter(c => `${c.id} ${c.alias || ""} ${c.label} ${c.description}`.toLowerCase().includes(needle));
}
if (typeof module !== "undefined") module.exports = { commands, parse, search };
else window.PhotoGitCommands = { commands, parse, search };
