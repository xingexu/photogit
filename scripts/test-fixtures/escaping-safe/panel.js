// Fixture: every interpolation escaped or provably constant.
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])); }
function icon() { return '<svg viewBox="0 0 24 24"></svg>'; }
function render(node, item) {
  const tone = item.ok ? "ready" : "blocked";
  const label = item.ok ? "Ready" : "Blocked";
  node.innerHTML = `<span class="${tone}">${label}</span><i>${icon()}</i><strong title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</strong>`;
}
