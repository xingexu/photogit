// Shared by the native palette and command directory. Never executed as shell code.
const commands = [
  ["changes", "Show changes", "Go to detected edits", "changes"],
  ["history", "Find a version", "Search saved versions", "history"],
  ["branches", "Show branches", "Switch design directions", "branches"],
  ["reviews", "Show reviews", "Compare and safely merge branches", "reviews"],
  ["activity", "Show activity", "Read operation results and errors", "activity"],
  ["docs", "Commands & docs", "Open this directory", "docs"],
  ["scan", "Scan document", "Read current Photoshop edits", "scan"],
  ["save", "Save a version", "Save exact PSD and metadata; commit is an alias", "save Refined typography", "commit"],
  ["branch", "Create branch", "Create and switch to a new branch", "branch cover-option-b"],
  ["switch", "Switch branch", "Confirm before opening the branch’s saved PSD", "switch main"],
  ["compare", "Compare branch", "Compare with the current branch", "compare cover-option-b"],
  ["merge", "Review a merge", "Show comparison and confirmation; never bypass conflicts", "merge cover-option-b"],
  ["tag", "Create tag", "Open the tag form", "tag"],
  ["status", "Project information", "Inspect the project and connection", "status"],
  ["connect", "Change project", "Choose a PhotoGit project folder", "connect"],
  ["reconnect", "Reconnect helper", "Retry the project’s local helper", "reconnect"],
  ["conflicts", "View conflicts", "Inspect conflicting file paths", "conflicts"],
  ["pull", "Pull shared versions", "Confirm before updating Git and opening a PSD", "pull"],
  ["push", "Push saved versions", "Confirm before sending this project to its remote", "push"]
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
module.exports = { commands, parse, search };
