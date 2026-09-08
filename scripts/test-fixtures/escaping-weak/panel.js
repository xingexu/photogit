// Fixture: an escaper that misses the quote characters an attribute needs.
function escapeHtml(value) { return String(value ?? "").replace(/[<>]/g, (char) => ({ "<": "&lt;", ">": "&gt;" }[char])); }
function render(node, item) {
  node.innerHTML = `<strong title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</strong>`;
}
